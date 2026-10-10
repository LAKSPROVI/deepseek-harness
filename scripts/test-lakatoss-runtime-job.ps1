param([string]$Runner=(Join-Path $PSScriptRoot 'run-lakatoss-web-runtime.ps1'))
$ErrorActionPreference='Stop'
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($Runner,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'runner_parse_failed'}
$function=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Initialize-RuntimeProcessJob'},$true)
if(-not $function){throw 'job_owner_function_missing'}
$base=Join-Path ([IO.Path]::GetTempPath()) ('lakatoss-job-test-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $base | Out-Null
$node='C:/Program Files/nodejs/node.exe'
$shell='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
$results=@();$owned=@()
try {
    foreach($mode in @('legacy','owned','normal')) {
        $dir=Join-Path $base $mode;New-Item -ItemType Directory -Path $dir | Out-Null
        $fixture=Join-Path $dir 'fixture.js'
        $js=if($mode -eq 'normal'){'setTimeout(() => process.exit(7), 500)'}else{'setInterval(() => {}, 1000)'}
        [IO.File]::WriteAllText($fixture,$js)
        $wrapper=Join-Path $dir 'wrapper.ps1'
        $body=$function.Extent.Text+@'

param_placeholder
$ErrorActionPreference='Stop'
if($Mode -ne 'legacy'){Initialize-RuntimeProcessJob}
$p=Start-Process -FilePath $Node -ArgumentList ('"'+$Fixture+'"') -WindowStyle Hidden -PassThru
$null=$p.Handle
[IO.File]::WriteAllText($Info,($p.Id.ToString()))
$p.WaitForExit();$p.Refresh()
[IO.File]::WriteAllText($Result,$p.ExitCode.ToString())
if($Mode -ne 'legacy'){[Lakatoss.RuntimeProcessJob]::ReleaseAfterChildrenExit()}
exit $p.ExitCode
'@
        $body=$body.Replace('param_placeholder','')
        $body="param([string]`$Mode,[string]`$Node,[string]`$Fixture,[string]`$Info,[string]`$Result)`n"+$body
        [IO.File]::WriteAllText($wrapper,$body,[Text.UTF8Encoding]::new($false))
        $info=Join-Path $dir 'pid.txt';$result=Join-Path $dir 'result.txt'
        $arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$wrapper+'" -Mode '+$mode+' -Node "'+$node+'" -Fixture "'+$fixture+'" -Info "'+$info+'" -Result "'+$result+'"'
        $p=Start-Process -FilePath $shell -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $dir 'stderr.txt')
        $null=$p.Handle
        $owned+=$p
        $until=[DateTime]::UtcNow.AddSeconds(20)
        while(-not (Test-Path -LiteralPath $info)){
            $p.Refresh();if($p.HasExited -or [DateTime]::UtcNow -gt $until){throw ('synthetic_wrapper_failed_'+$mode)}
            Start-Sleep -Milliseconds 100
        }
        $childId=[int][IO.File]::ReadAllText($info)
        $child=Get-Process -Id $childId -ErrorAction SilentlyContinue
        if($child){$owned+=$child}
        if($mode -eq 'normal'){
            if(-not $p.WaitForExit(10000)){throw 'normal_wrapper_not_exited'}
            $p.Refresh()
            if($p.ExitCode -ne 7 -or [IO.File]::ReadAllText($result) -cne '7'){throw 'normal_exit_not_preserved'}
        }else{
            # Only this test's newly created wrapper is terminated.
            $p.Kill();$p.WaitForExit()
            $until=[DateTime]::UtcNow.AddSeconds(5)
            while((Get-Process -Id $childId -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $until){Start-Sleep -Milliseconds 100}
            $alive=Get-Process -Id $childId -ErrorAction SilentlyContinue
            if($mode -eq 'legacy' -and -not $alive){throw 'legacy_control_did_not_reproduce_orphan'}
            if($mode -eq 'owned' -and $alive){throw 'job_failed_to_close_child'}
        }
        $results+=[pscustomobject]@{test=$mode;passed=$true}
    }
    [pscustomobject]@{ok=$true;tests=$results;onlySyntheticProcesses=$true} | ConvertTo-Json -Depth 4
}finally{
    foreach($p in $owned){try{$p.Refresh();if(-not $p.HasExited){$p.Kill();$p.WaitForExit(5000)|Out-Null}}catch{}}
    # Preserve test artifacts for inspection; no recursive deletion.
}
