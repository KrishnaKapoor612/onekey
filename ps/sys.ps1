param(
  [Parameter(Mandatory=$true)][string]$Action,
  [string]$Mode = '',
  [int64]$TargetId = 0,
  [int]$SelfPid = 0,
  [int]$Amount = 0,
  [string]$Keys = ''
)
$ErrorActionPreference = 'Stop'
$Arg = [string]$env:ONEKEY_ARG
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ('OneKeySys' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class OneKeySys {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int ht, uint flags);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

  // Visible, titled, non-cloaked top-level windows in Z-order (topmost first).
  public static List<object[]> Windows() {
    var r = new List<object[]>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      int n = GetWindowTextLength(h);
      if (n == 0) return true;
      int ex = GetWindowLong(h, -20);
      if ((ex & 0x80) != 0 && (ex & 0x40000) == 0) return true;
      int cl = 0;
      DwmGetWindowAttribute(h, 14, out cl, 4);
      if (cl != 0) return true;
      var sb = new StringBuilder(n + 1);
      GetWindowText(h, sb, sb.Capacity);
      string t = sb.ToString();
      if (t == "Program Manager") return true;
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      r.Add(new object[] { h.ToInt64(), (int)pid, t });
      return true;
    }, IntPtr.Zero);
    return r;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT val, int size);

  public static int[] Bounds(IntPtr h) {
    RECT r;
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) == 0 && r.Right > r.Left && r.Bottom > r.Top) {
      return new int[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
    }
    if (GetWindowRect(h, out r)) {
      return new int[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
    }
    return null;
  }
  public static long Fg() { return GetForegroundWindow().ToInt64(); }
  public static bool Activate(IntPtr h) {
    if (IsIconic(h)) { ShowWindow(h, 9); System.Threading.Thread.Sleep(150); }
    uint pid;
    uint fgT = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    uint me = GetCurrentThreadId();
    bool att = false;
    if (fgT != me) att = AttachThreadInput(me, fgT, true);
    bool r = SetForegroundWindow(h);
    if (att) AttachThreadInput(me, fgT, false);
    return r;
  }
  public static void Place(IntPtr h, int x, int y, int w, int ht) { ShowWindow(h, 9); SetWindowPos(h, IntPtr.Zero, x, y, w, ht, 0x0044u); }
  public static void Show(IntPtr h, int cmd) { ShowWindow(h, cmd); }
  public static void Close(IntPtr h) { PostMessage(h, 0x0010u, IntPtr.Zero, IntPtr.Zero); }
  public static void Click(bool right, int count) {
    uint d = right ? 0x8u : 0x2u;
    uint u = right ? 0x10u : 0x4u;
    for (int i = 0; i < count; i++) {
      mouse_event(d, 0, 0, 0, UIntPtr.Zero);
      mouse_event(u, 0, 0, 0, UIntPtr.Zero);
      System.Threading.Thread.Sleep(60);
    }
  }
  public static void Wheel(int notches) { mouse_event(0x800u, 0, 0, notches * 120, UIntPtr.Zero); }
}
'@
}

function Out($o) { [Console]::Out.WriteLine((ConvertTo-Json -InputObject $o -Compress -Depth 5)) }

# All usable windows except OneKey's own. Emits plain objects (no wrapping) so @(Get-All) is always a flat array.
function Get-All {
  $names = @{}
  Get-Process | ForEach-Object { $names[[int]$_.Id] = $_.ProcessName }
  $fg = [OneKeySys]::Fg()
  $r = @()
  foreach ($w in [OneKeySys]::Windows()) {
    $p = [int]$w[1]
    if ($p -eq $SelfPid) { continue }
    $pn = ''
    if ($names.ContainsKey($p)) { $pn = [string]$names[$p] }
    $r += [pscustomobject]@{ Handle = [int64]$w[0]; Pid = $p; Title = [string]$w[2]; Proc = $pn; Active = ([int64]$w[0] -eq $fg) }
  }
  $r
}

# The window the user was last working in: the foreground window, or (if OneKey itself is in front) the top window behind it.
function Get-Target {
  $ws = @(Get-All)
  if ($ws.Count -eq 0) { return $null }
  foreach ($w in $ws) { if ($w.Active) { return $w } }
  return $ws[0]
}

function Switch-To($t) {
  [void][OneKeySys]::Activate([IntPtr][int64]$t.Handle)
  Start-Sleep -Milliseconds 250
  return ([OneKeySys]::Fg() -eq [int64]$t.Handle)
}

try {
  switch ($Action) {
    'apps' {
      $apps = @(Get-StartApps | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; appId = [string]$_.AppID } })
      Out @{ ok = $true; apps = $apps }
    }
    'launch' {
      if (-not $Arg) { Out @{ ok = $false; error = 'bad-arg'; message = 'No app id given.' }; exit 0 }
      $target = 'shell:AppsFolder\' + $Arg
      Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $target + '"')
      Out @{ ok = $true }
    }
    'focus' {
      $ws = @(Get-All)
      if ($TargetId -ne 0) {
        $m = @($ws | Where-Object { $_.Handle -eq $TargetId })
      } else {
        $q = $Arg.ToLower()
        $m = @($ws | Where-Object { $_.Title.ToLower().Contains($q) -or $_.Proc.ToLower().Contains($q) })
        if ($m.Count -gt 1) {
          $exact = @($m | Where-Object { $_.Proc.ToLower() -eq $q })
          if ($exact.Count -eq 1) { $m = $exact }
        }
      }
      if ($m.Count -eq 0) { Out @{ ok = $false; error = 'no-window' }; exit 0 }
      if ($m.Count -gt 1) { Out @{ ok = $false; error = 'ambiguous'; windows = @($m | Select-Object -First 8) }; exit 0 }
      $t = $m[0]
      if (Switch-To $t) { Out @{ ok = $true; verified = $true; window = $t } }
      else { Out @{ ok = $false; error = 'focus-failed'; message = 'Windows did not allow the focus change.' } }
    }
    'keys' {
      $t = Get-Target
      if (-not $t) { Out @{ ok = $false; error = 'no-window'; message = 'No other window to send keys to.' }; exit 0 }
      if (-not $t.Active) {
        if (-not (Switch-To $t)) { Out @{ ok = $false; error = 'focus-failed'; message = 'Windows did not allow the focus change; keys were NOT sent.' }; exit 0 }
      }
      foreach ($step in ($Keys -split '\|')) {
        if ($step -match '^sleep:(\d+)$') { Start-Sleep -Milliseconds ([int]$Matches[1]) }
        elseif ($step) { [System.Windows.Forms.SendKeys]::SendWait($step) }
      }
      Out @{ ok = $true; window = $t }
    }
    'window' {
      if ($TargetId -ne 0) { $t = @(Get-All | Where-Object { $_.Handle -eq $TargetId })[0] } else { $t = Get-Target }
      if (-not $t) { Out @{ ok = $false; error = 'no-window' }; exit 0 }
      $h = [IntPtr][int64]$t.Handle
      switch ($Mode) {
        'snap_left' {
          $wa = [System.Windows.Forms.Screen]::FromHandle($h).WorkingArea
          $half = [int]($wa.Width / 2)
          [OneKeySys]::Place($h, $wa.X, $wa.Y, $half, $wa.Height)
        }
        'snap_right' {
          $wa = [System.Windows.Forms.Screen]::FromHandle($h).WorkingArea
          $half = [int]($wa.Width / 2)
          [OneKeySys]::Place($h, $wa.X + $half, $wa.Y, $wa.Width - $half, $wa.Height)
        }
        'maximize' { [OneKeySys]::Show($h, 3) }
        'minimize' { [OneKeySys]::Show($h, 6) }
        'restore'  { [OneKeySys]::Show($h, 9) }
        'close'    { [OneKeySys]::Close($h) }
        default { Out @{ ok = $false; error = 'bad-mode'; message = 'Unknown window mode.' }; exit 0 }
      }
      Out @{ ok = $true; window = $t }
    }
    'mouse-move' {
      $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
      $pb = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      $c = [System.Windows.Forms.Cursor]::Position
      $x = [int]$c.X
      $y = [int]$c.Y
      $amt = $Amount
      if ($amt -le 0) { $amt = 200 }

      $t = Get-Target
      $wb = $null
      if ($t) { $wb = [OneKeySys]::Bounds([IntPtr][int64]$t.Handle) }

      switch ($Mode) {
        'left'  { $x = $x - $amt }
        'right' { $x = $x + $amt }
        'up'    { $y = $y - $amt }
        'down'  { $y = $y + $amt }
        'center' {
          if ($wb) {
            $x = $wb[0] + [int]($wb[2] / 2)
            $y = $wb[1] + [int]($wb[3] / 2)
          } else {
            $x = $pb.X + [int]($pb.Width / 2)
            $y = $pb.Y + [int]($pb.Height / 2)
          }
        }
        'top-left' {
          if ($wb) { $x = $wb[0] + 25; $y = $wb[1] + 25 }
          else { $x = $pb.X + 40; $y = $pb.Y + 40 }
        }
        'top-right' {
          if ($wb) {
            # Standard Windows window close cross [X] is ~25px from right, ~15px from top
            $x = $wb[0] + $wb[2] - 25
            $y = $wb[1] + 15
          } else {
            $x = $pb.X + $pb.Width - 40; $y = $pb.Y + 40
          }
        }
        'bottom-left' {
          if ($wb) { $x = $wb[0] + 25; $y = $wb[1] + $wb[3] - 25 }
          else { $x = $pb.X + 40; $y = $pb.Y + $pb.Height - 40 }
        }
        'bottom-right' {
          if ($wb) { $x = $wb[0] + $wb[2] - 25; $y = $wb[1] + $wb[3] - 25 }
          else { $x = $pb.X + $pb.Width - 40; $y = $pb.Y + $pb.Height - 40 }
        }
        default { Out @{ ok = $false; error = 'bad-mode'; message = 'Unknown cursor move.' }; exit 0 }
      }
      $x = [Math]::Max($vs.Left, [Math]::Min($vs.Right - 1, $x))
      $y = [Math]::Max($vs.Top, [Math]::Min($vs.Bottom - 1, $y))

      # Smooth ease-out interpolation
      $startX = [int]$c.X
      $startY = [int]$c.Y
      $dist = [Math]::Sqrt([Math]::Pow($x - $startX, 2) + [Math]::Pow($y - $startY, 2))
      $steps = [Math]::Max(6, [Math]::Min(14, [int]($dist / 35)))
      for ($i = 1; $i -le $steps; $i++) {
        $tNorm = [double]$i / [double]$steps
        $ease = 1.0 - [Math]::Pow(1.0 - $tNorm, 3)
        $curX = [int]($startX + ($x - $startX) * $ease)
        $curY = [int]($startY + ($y - $startY) * $ease)
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($curX, $curY)
        [System.Threading.Thread]::Sleep(7)
      }
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
      Out @{ ok = $true; x = $x; y = $y }
    }
    'mouse-click' {
      $n = [Math]::Max(1, [Math]::Min(2, $Amount))
      [OneKeySys]::Click(($Mode -eq 'right'), $n)
      Out @{ ok = $true }
    }
    'screenshot' {
      $picFolder = [Environment]::GetFolderPath('MyPictures')
      if (-not $picFolder) { $picFolder = [System.IO.Path]::Combine($env:USERPROFILE, 'Pictures') }
      $shotDir = [System.IO.Path]::Combine($picFolder, 'Screenshots')
      if (-not (Test-Path $shotDir)) { [void](New-Item -ItemType Directory -Path $shotDir -Force) }

      $stamp = (Get-Date).ToString('yyyy-MM-dd_HHmmss')
      $fileName = "Screenshot_$stamp.png"
      $filePath = [System.IO.Path]::Combine($shotDir, $fileName)

      $t = Get-Target
      $capRect = $null
      if ($Mode -ne 'screen' -and $t) {
        $wb = [OneKeySys]::Bounds([IntPtr][int64]$t.Handle)
        if ($wb -and $wb[2] -gt 50 -and $wb[3] -gt 50) {
          $capRect = New-Object System.Drawing.Rectangle($wb[0], $wb[1], $wb[2], $wb[3])
        }
      }
      if (-not $capRect) {
        $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
        $capRect = New-Object System.Drawing.Rectangle($vs.Left, $vs.Top, $vs.Width, $vs.Height)
      }

      $bmp = New-Object System.Drawing.Bitmap($capRect.Width, $capRect.Height)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.CopyFromScreen($capRect.Left, $capRect.Top, 0, 0, $capRect.Size, [System.Drawing.CopyPixelOperation]::SourceCopy)
        $bmp.Save($filePath, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $g.Dispose()
        $bmp.Dispose()
      }
      Out @{ ok = $true; path = $filePath; file = $fileName; folder = $shotDir }
    }
    default { Out @{ ok = $false; error = 'bad-action' } }
  }
} catch {
  Out @{ ok = $false; error = 'exception'; message = $_.Exception.Message }
}
