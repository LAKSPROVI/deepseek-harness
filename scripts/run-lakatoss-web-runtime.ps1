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
    [Parameter(Mandatory = $true)][string]$LogDirectory,
    [ValidatePattern('^$|^[a-fA-F0-9]{64}$')][string]$ExpectedOverlaySha256 = '',
    [string]$ExpectedOverlayCut = ''
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

$overlay = $null
if ($ExpectedOverlaySha256) {
    $overlayPath = Resolve-ExistingLiteralPath (Join-Path $root 'dsh-runtime-overlay.json') $false
    if ((Get-FileHash -LiteralPath $overlayPath -Algorithm SHA256).Hash -ine $ExpectedOverlaySha256) { throw 'Runtime overlay manifest differs from the reviewed hash.' }
    $overlay = Get-Content -LiteralPath $overlayPath -Raw | ConvertFrom-Json
    if ($overlay.schemaVersion -ne 1 -or $overlay.baseCommit -cne $ExpectedCommit -or (-not $ExpectedOverlayCut -or $overlay.cut -cne $ExpectedOverlayCut)) { throw 'Unexpected runtime overlay identity.' }
    foreach ($file in $overlay.files) {
        $full = [IO.Path]::GetFullPath((Join-Path $root $file.relativePath))
        if (-not $full.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Runtime overlay file escaped the reviewed root.' }
        $literal = Resolve-ExistingLiteralPath $full $false
        if ((Get-FileHash -LiteralPath $literal -Algorithm SHA256).Hash -ine $file.sha256) { throw 'Runtime overlay bytes differ from the reviewed module.' }
    }
}

function Initialize-RuntimeProcessJob {
    # The wrapper joins before spawning Node. Children inherit this job; there is
    # no interval in which the backend runs outside its wrapper's lifetime.
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace Lakatoss {
    public static class RuntimeProcessJob {
        [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
            public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)] struct IoCounters {
            public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
            public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
        }
        [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
            public BasicLimits BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
        }
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        [StructLayout(LayoutKind.Sequential)] struct Accounting {
            public long TotalUserTime, TotalKernelTime, PeriodUserTime, PeriodKernelTime;
            public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
        }
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out Accounting info, uint length, IntPtr returned);
        // Intentionally retained until this wrapper exits. Windows closes the
        // non-inherited handle on normal exit and on Task Scheduler termination.
        static IntPtr ownedJob = IntPtr.Zero;
        public static void Attach() {
            if (ownedJob != IntPtr.Zero) throw new InvalidOperationException("runtime_job_already_attached");
            IntPtr job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            IntPtr data = IntPtr.Zero;
            try {
                var limits = new ExtendedLimits();
                limits.BasicLimitInformation.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE
                int size = Marshal.SizeOf(typeof(ExtendedLimits));
                data = Marshal.AllocHGlobal(size);
                Marshal.StructureToPtr(limits, data, false);
                if (!SetInformationJobObject(job, 9, data, (uint)size))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                if (!AssignProcessToJobObject(job, GetCurrentProcess()))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                ownedJob = job;
            } catch { CloseHandle(job); throw; }
            finally { if (data != IntPtr.Zero) Marshal.FreeHGlobal(data); }
        }
        public static void ReleaseAfterChildrenExit() {
            Accounting info;
            if (ownedJob == IntPtr.Zero || !QueryInformationJobObject(ownedJob, 1, out info,
                (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            // Only the wrapper may remain. Never release live descendants.
            if (info.ActiveProcesses != 1) throw new InvalidOperationException("runtime_children_still_running");
            var limits = new ExtendedLimits();
            int size = Marshal.SizeOf(typeof(ExtendedLimits));
            IntPtr data = Marshal.AllocHGlobal(size);
            try {
                Marshal.StructureToPtr(limits, data, false);
                if (!SetInformationJobObject(ownedJob, 9, data, (uint)size))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                CloseHandle(ownedJob); ownedJob = IntPtr.Zero;
            } finally { Marshal.FreeHGlobal(data); }
        }
    }
}
'@
    [Lakatoss.RuntimeProcessJob]::Attach()
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
    overlayCut = $(if ($overlay) { $overlay.cut } else { $null })
    overlayCommit = $(if ($overlay) { $overlay.overlayCommit } else { $null })
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
    Initialize-RuntimeProcessJob
    $receipt.processJob = 'kill_on_wrapper_exit'
    $child = Start-Process -FilePath $node -ArgumentList @('apps\cli\lib\bin.js', 'web', '--no-open') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $null = $child.Handle
    $receipt.childPid = $child.Id
    $receipt.childCreatedAt = $child.StartTime.ToUniversalTime().ToString('o')
    $receipt.phase = 'running'
    Save-Receipt
    $vitalsPath = Join-Path $logPath ('dsh-runtime-vitals-' + $runId + '.jsonl')
    Assert-LogDestination $vitalsPath
    function Write-ChildVitals {
        try {
            $child.Refresh()
            $sample = [ordered]@{ at = [DateTime]::UtcNow.ToString('o'); pid = $child.Id; exited = $child.HasExited }
            if ($child.HasExited) { $sample.exitCode = $child.ExitCode }
            else {
                $sample.workingSetBytes = $child.WorkingSet64
                $sample.privateMemoryBytes = $child.PrivateMemorySize64
                $sample.cpuSeconds = $child.TotalProcessorTime.TotalSeconds
            }
            [IO.File]::AppendAllText($vitalsPath, (($sample | ConvertTo-Json -Compress) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
        } catch { }
    }
    # Diagnostics must not change child lifetime or trigger any restart.
    Write-ChildVitals
    while (-not $child.WaitForExit(60000)) { Write-ChildVitals }
    Write-ChildVitals
    $child.Refresh()
    $receipt.exitCode = $child.ExitCode
    $receipt.exitedAt = [DateTime]::UtcNow.ToString('o')
    $receipt.phase = 'exited'
    Save-Receipt
    [Lakatoss.RuntimeProcessJob]::ReleaseAfterChildrenExit()
    exit $child.ExitCode
}
catch {
    $receipt.phase = 'runner_failed'
    $receipt.exitedAt = [DateTime]::UtcNow.ToString('o')
    $receipt.exitCode = 1
    Save-Receipt
    throw
}
