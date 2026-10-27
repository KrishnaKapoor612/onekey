param(
  [Parameter(Mandatory=$true)][string]$Action,
  [string]$ProcessName = '',
  [int64]$TargetId = 0,
  [string]$Keys = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

if (-not ('OneKeyWin' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class OneKeyWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

  public static List<object[]> Windows() {
    var r = new List<object[]>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      int n = GetWindowTextLength(h);
      if (n == 0) return true;
      var sb = new StringBuilder(n + 1);
      GetWindowText(h, sb, sb.Capacity);
      uint pid; GetWindowThreadProcessId(h, out pid);
      r.Add(new object[] { h.ToInt64(), (int)pid, sb.ToString() });
      return true;
    }, IntPtr.Zero);
    return r;
  }
  public static long FgHandle() { return GetForegroundWindow().ToInt64(); }
  public static int FgPid() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return (int)pid; }
  public static bool Activate(IntPtr h) {
    if (IsIconic(h)) { ShowWindowAsync(h, 9); System.Threading.Thread.Sleep(150); }
    uint pid; uint fgT = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    uint me = GetCurrentThreadId();
    bool att = false;
    if (fgT != me) att = AttachThreadInput(me, fgT, true);
    bool r = SetForegroundWindow(h);
    if (att) AttachThreadInput(me, fgT, false);
    return r;
  }
}
'@
}

function Out($o) { [Console]::Out.WriteLine((ConvertTo-Json -InputObject $o -Compress -Depth 5)) }

function Get-Wins([string]$name) {
  $ids = @(Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  $out = @()
  if ($ids.Count -eq 0) { return $out }
  $fg = [OneKeyWin]::FgHandle()
  foreach ($w in [OneKeyWin]::Windows()) {
    if ($ids -contains [int]$w[1]) {
      $out += [pscustomobject]@{ Handle = [int64]$w[0]; Pid = [int]$w[1]; Title = [string]$w[2]; Active = ([int64]$w[0] -eq $fg) }
    }
  }
  return $out
}

try {
  switch ($Action) {
    'list' {
      $ws = @(Get-Wins $ProcessName)
      Out @{ ok = $true; windows = $ws }
    }
    'focus' {
      $ws = @(Get-Wins $ProcessName)
      if ($ws.Count -eq 0) { Out @{ ok = $false; error = 'no-window' }; exit 0 }
      $target = $null
      if ($TargetId -ne 0) {
        $target = $ws | Where-Object { $_.Handle -eq $TargetId } | Select-Object -First 1
        if (-not $target) { Out @{ ok = $false; error = 'no-window' }; exit 0 }
      } elseif ($ws.Count -eq 1) {
        $target = $ws[0]
      } else {
        $target = $ws | Where-Object { $_.Active } | Select-Object -First 1
        if (-not $target) { Out @{ ok = $false; error = 'ambiguous'; windows = $ws }; exit 0 }
      }
      [void][OneKeyWin]::Activate([IntPtr]$target.Handle)
      Start-Sleep -Milliseconds 200
      $good = ([OneKeyWin]::FgHandle() -eq $target.Handle)
      if ($good) { Out @{ ok = $true; verified = $true; window = $target } }
      else { Out @{ ok = $false; error = 'focus-failed'; message = 'Windows did not allow the focus change.' } }
    }
    'keys' {
      $ws = @(Get-Wins $ProcessName)
      $fgPid = [OneKeyWin]::FgPid()
      if (-not ($ws | Where-Object { $_.Pid -eq $fgPid })) { Out @{ ok = $false; error = 'wrong-focus' }; exit 0 }
      foreach ($step in ($Keys -split '\|')) {
        if ($step -match '^sleep:(\d+)$') { Start-Sleep -Milliseconds ([int]$Matches[1]) }
        elseif ($step) { [System.Windows.Forms.SendKeys]::SendWait($step) }
      }
      Out @{ ok = $true }
    }
    default { Out @{ ok = $false; error = 'bad-action' } }
  }
} catch {
  Out @{ ok = $false; error = 'exception'; message = $_.Exception.Message }
}