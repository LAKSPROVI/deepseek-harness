#requires -Version 5.1
<#
.SYNOPSIS
Checks the manual runtime helpers with local synthetic CLI files; registers no task.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PowerShellPath,
    [Parameter(Mandatory = $true)][string]$NodePath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$runner = Join-Path $PSScriptRoot 'run-lakatoss-web-runtime.ps1'
$builder = Join-Path $PSScriptRoot 'new-lakatoss-web-runtime-task.ps1'
foreach ($path in @($runner, $builder)) {
    $tokens = $null
    $parseErrors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors)
    if (@($parseErrors).Count -ne 0) { throw 'Helper has PowerShell parse errors.' }
}
$testDirectory = Join-Path ([IO.Path]::GetTempPath()) ('lakatoss-task-fixture-' + [Guid]::NewGuid().ToString('N'))
$commit = '4444444444444444444444444444444444444444'
$source = Join-Path $testDirectory 'source-4444444444'
$entryDirectory = Join-Path $source 'apps\cli\lib'
$homePath = Join-Path $testDirectory 'home'
$logs = Join-Path $testDirectory 'logs'
foreach ($path in @($entryDirectory, $homePath, $logs)) {
    [void][IO.Directory]::CreateDirectory($path)
}
$entry = Join-Path $entryDirectory 'bin.js'
$encoding = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($entry, "process.stdout.write(JSON.stringify(process.argv.slice(2))); process.stderr.write('fixture stderr'); process.exit(7)", $encoding)
[IO.File]::WriteAllText((Join-Path $logs 'dsh-current.stdout.log'), 'previous stdout', $encoding)
[IO.File]::WriteAllText((Join-Path $logs 'dsh-current.stderr.log'), 'previous stderr', $encoding)
$arguments = @{
    SourceRoot = $source
    ExpectedCommit = $commit
    ExpectedEntrySha256 = (Get-FileHash -LiteralPath $entry -Algorithm SHA256).Hash
    ExpectedRunnerSha256 = (Get-FileHash -LiteralPath $runner -Algorithm SHA256).Hash
    NodePath = $NodePath
    DshHome = $homePath
    LogDirectory = $logs
}
try {
    foreach ($property in @('ExpectedCommit', 'ExpectedEntrySha256', 'ExpectedRunnerSha256')) {
        $bad = $arguments.Clone()
        $bad[$property] = if ($property -eq 'ExpectedCommit') { '5555555555555555555555555555555555555555' } else { '0' * 64 }
        $previousPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & $PowerShellPath -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File $runner @bad 2>&1 | Out-Null
            $guardExitCode = $LASTEXITCODE
        }
        finally { $ErrorActionPreference = $previousPreference }
        if ($guardExitCode -eq 0) { throw 'Runner accepted a mismatched reviewed artifact.' }
        if (Test-Path -LiteralPath (Join-Path $logs 'dsh-web-runtime-receipt.json')) {
            throw 'A rejected artifact wrote runtime state.'
        }
        if ((Get-Content -LiteralPath (Join-Path $logs 'dsh-current.stdout.log') -Raw) -ne 'previous stdout') {
            throw 'A rejected artifact modified existing logs.'
        }
    }
    $task = & $builder -RunnerPath $runner @arguments -UserId ($env:USERDOMAIN + '\' + $env:USERNAME) -PowerShellPath $PowerShellPath
    if ($null -ne $task.Triggers -and @($task.Triggers).Count -ne 0) { throw 'Manual task unexpectedly has triggers.' }
    if ($task.Settings.RestartCount -ne 0 -or $task.Settings.ExecutionTimeLimit -ne 'PT0S') {
        throw 'Manual task has recovery or an execution deadline.'
    }
    if ([string]$task.Settings.MultipleInstances -ne 'IgnoreNew') { throw 'Task permits duplicate instances.' }
    if ($task.Actions[0].Arguments -notmatch '-WindowStyle Hidden') { throw 'Task window must be hidden.' }
    & $PowerShellPath -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File $runner @arguments
    if ($LASTEXITCODE -ne 7) { throw 'Runner failed to propagate the child exit code.' }
    $receipt = Get-Content -LiteralPath (Join-Path $logs 'dsh-web-runtime-receipt.json') -Raw | ConvertFrom-Json
    if ($receipt.exitCode -ne 7 -or $receipt.phase -ne 'exited' -or $receipt.childPid -le 0) {
        throw 'Runner did not record a settled synthetic child.'
    }
    if ((Get-Content -LiteralPath (Join-Path $logs 'dsh-current.stdout.log') -Raw) -ne '["web","--no-open"]') {
        throw 'Runner changed the supported CLI arguments.'
    }
    $before = @(Get-ChildItem -LiteralPath $logs -Filter 'dsh-current.*.log.before-*')
    if ($before.Count -ne 2) { throw 'Existing logs were not preserved.' }
    $beforeValues = @($before | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw })
    if ($beforeValues -notcontains 'previous stdout' -or $beforeValues -notcontains 'previous stderr') {
        throw 'Preserved logs changed.'
    }
    $receiptText = Get-Content -LiteralPath (Join-Path $logs 'dsh-web-runtime-receipt.json') -Raw
    if ($receiptText -match 'API_KEY|token=|Bearer ') { throw 'Receipt contains credential-related content.' }
    [pscustomobject]@{
        ok = $true
        powerShellVersion = $PSVersionTable.PSVersion.ToString()
        cases = @('parse', 'commit_guard', 'entry_sha_guard', 'runner_sha_guard', 'manual_only', 'no_restart', 'hidden', 'supported_cli', 'exit_code_7', 'receipt', 'log_backup', 'no_credentials_in_receipt')
    } | ConvertTo-Json -Depth 3
}
finally {
    $resolved = [IO.Path]::GetFullPath($testDirectory)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Fixture cleanup left the temporary directory.'
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
