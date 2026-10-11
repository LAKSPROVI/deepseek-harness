#requires -Version 5.1
<#
.SYNOPSIS
Builds a manual-only Lakatoss Web task definition without registering or running it.
.DESCRIPTION
The caller reviews and registers the returned definition as LakatossWebRuntime.
Interactive logon, no triggers, no automatic restart, no execution deadline,
and IgnoreNew preserve a manually started app across launcher-shell exits.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RunnerPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedRunnerSha256,
    [Parameter(Mandatory = $true)][string]$SourceRoot,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$ExpectedCommit,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedEntrySha256,
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $true)][string]$DshHome,
    [Parameter(Mandatory = $true)][string]$LogDirectory,
    [Parameter(Mandatory = $true)][string]$UserId,
    [Parameter(Mandatory = $true)][string]$PowerShellPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Quote-TaskArgument([string]$Value) {
    if ($Value.Contains('"') -or $Value.Contains([char]13) -or $Value.Contains([char]10)) {
        throw 'Task arguments cannot contain quotes or line breaks.'
    }
    return '"' + $Value + '"'
}
foreach ($path in @($RunnerPath, $SourceRoot, $NodePath, $DshHome, $LogDirectory, $PowerShellPath)) {
    if (-not [IO.Path]::IsPathRooted($path) -or -not (Test-Path -LiteralPath $path)) {
        throw 'Task paths must be existing absolute paths.'
    }
}
if ((Get-FileHash -LiteralPath $RunnerPath -Algorithm SHA256).Hash -ine $ExpectedRunnerSha256) {
    throw 'Task runner bytes differ from the reviewed script hash.'
}
$arguments = @(
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
    '-File', (Quote-TaskArgument $RunnerPath),
    '-SourceRoot', (Quote-TaskArgument $SourceRoot),
    '-ExpectedCommit', $ExpectedCommit,
    '-ExpectedEntrySha256', $ExpectedEntrySha256,
    '-ExpectedRunnerSha256', $ExpectedRunnerSha256,
    '-NodePath', (Quote-TaskArgument $NodePath),
    '-DshHome', (Quote-TaskArgument $DshHome),
    '-LogDirectory', (Quote-TaskArgument $LogDirectory)
) -join ' '
$action = New-ScheduledTaskAction -Execute $PowerShellPath -Argument $arguments -WorkingDirectory $SourceRoot
$principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden
New-ScheduledTask -Action $action -Principal $principal -Settings $settings -Description 'Manual Lakatoss Web runtime; no triggers or automatic restart.'
