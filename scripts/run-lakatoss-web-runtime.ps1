#requires -Version 5.1
<#
.SYNOPSIS
Runs one pinned Lakatoss Web CLI under a manually started Windows task.
.DESCRIPTION
The caller owns artifact validation and task registration. This runner verifies the
pinned root, CLI, and runner, preserves existing logs, then waits for the child.
It creates no scheduled triggers, recovery loop, or changes to MCP configuration.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SourceRoot,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$ExpectedCommit,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedEntrySha256,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedRunnerSha256,
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][string]$DshHome,
    [Parameter(Mandatory = $true)][string]$LogDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Resolve-ExistingLiteralPath([string]$Path, [bool]$Directory) {
    if (-not [IO.Path]::IsPathRooted($Path)) { throw 'Runtime paths must be absolute.' }
    $full = [IO.Path]::GetFullPath($Path)
    if ([IO.Path]::GetPathRoot($full) -notmatch '^[a-zA-Z]:\\$') { throw 'Runtime paths must be local drive paths.' }
    $item = Get-Item -LiteralPath $full -Force -ErrorAction Stop
    if ($item.PSIsContainer -ne $Directory) { throw 'Runtime path has the wrong file kind.' }
    $ancestor = $item
    while ($null -ne $ancestor) {
        if (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Runtime paths and their parents must not contain links.'
        }
        if ($ancestor -is [IO.DirectoryInfo]) { $ancestor = $ancestor.Parent }
        else { $ancestor = $ancestor.Directory }
    }
    return $item.FullName
}
$root = Resolve-ExistingLiteralPath $SourceRoot $true
if ((Split-Path -Leaf $root) -cne ('source-' + $ExpectedCommit.Substring(0, 10).ToLowerInvariant())) {
    throw 'Frozen runtime directory does not match the reviewed commit.'
}
$entry = Resolve-ExistingLiteralPath (Join-Path $root 'apps\cli\lib\bin.js') $false
$node = Resolve-ExistingLiteralPath $NodePath $false
$homePath = Resolve-ExistingLiteralPath $DshHome $true
$logPath = Resolve-ExistingLiteralPath $LogDirectory $true
if ((Get-FileHash -LiteralPath $entry -Algorithm SHA256).Hash -ine $ExpectedEntrySha256) {
    throw 'Frozen CLI bytes differ from the reviewed entry hash.'
}
if ((Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash -ine $ExpectedRunnerSha256) {
    throw 'Runtime runner bytes differ from the reviewed script hash.'
}
if (Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq 3080 }) {
    throw 'Port 3080 already has a listener; no process was stopped.'
}

$runId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N')
$stdout = Join-Path $logPath 'dsh-current.stdout.log'
$stderr = Join-Path $logPath 'dsh-current.stderr.log'
$receiptPath = Join-Path $logPath 'dsh-web-runtime-receipt.json'
function Assert-LogDestination([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    $expectedParent = [IO.Directory]::GetParent($full).FullName
    if ($expectedParent -ine $logPath) { throw 'Runtime log destination escaped its reviewed directory.' }
    if (Test-Path -LiteralPath $full) { [void](Resolve-ExistingLiteralPath $full $false) }
}

foreach ($path in @($stdout, $stderr, $receiptPath)) {
    Assert-LogDestination $path
    if (Test-Path -LiteralPath $path) {
        $existing = Get-Item -LiteralPath $path -Force
        if ($existing.PSIsContainer -or (($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
            throw 'Runtime log destination must be a literal file.'
        }
        $backup = $path + '.before-' + $runId
        Assert-LogDestination $backup
        Move-Item -LiteralPath $path -Destination $backup -ErrorAction Stop
    }
}
$receipt = [ordered]@{
    schemaVersion = 1
    runId = $runId
    startedAt = [DateTime]::UtcNow.ToString('o')
    sourceRoot = $root
    expectedCommit = $ExpectedCommit
    wrapperPid = $PID
    childPid = $null
    childCreatedAt = $null
    exitedAt = $null
    exitCode = $null
    phase = 'starting'
}
function Save-Receipt {
    $temporary = $receiptPath + '.' + $runId + '.tmp'
    Assert-LogDestination $temporary
    Assert-LogDestination $receiptPath
    [IO.File]::WriteAllText($temporary, ($receipt | ConvertTo-Json -Depth 3), (New-Object Text.UTF8Encoding($false)))
    if ([IO.File]::Exists($receiptPath)) { [IO.File]::Replace($temporary, $receiptPath, [NullString]::Value) }
    else { [IO.File]::Move($temporary, $receiptPath) }
}
$env:DSH_HOME = $homePath
foreach ($variable in [Environment]::GetEnvironmentVariables('User').GetEnumerator()) {
    if ([string]$variable.Key -match 'ROUTER|TYPESAFE|GROQ') {
        [Environment]::SetEnvironmentVariable([string]$variable.Key, [string]$variable.Value, 'Process')
    }
}
Save-Receipt
try {
    $child = Start-Process -FilePath $node -ArgumentList @('apps\cli\lib\bin.js', 'web', '--no-open') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $null = $child.Handle
    $receipt.childPid = $child.Id
    $receipt.childCreatedAt = $child.StartTime.ToUniversalTime().ToString('o')
    $receipt.phase = 'running'
    Save-Receipt
    $child.WaitForExit()
    $child.Refresh()
    $receipt.exitCode = $child.ExitCode
    $receipt.exitedAt = [DateTime]::UtcNow.ToString('o')
    $receipt.phase = 'exited'
    Save-Receipt
    exit $child.ExitCode
}
catch {
    $receipt.phase = 'runner_failed'
    $receipt.exitedAt = [DateTime]::UtcNow.ToString('o')
    $receipt.exitCode = 1
    Save-Receipt
    throw
}
