param([string]$Culture = 'en-US', [int]$TimeoutSec = 8, [switch]$Check)
$ErrorActionPreference = 'Stop'
function Out($o) { [Console]::Out.WriteLine((ConvertTo-Json -InputObject $o -Compress -Depth 4)) }
try {
  Add-Type -AssemblyName System.Speech
  if ($Check) {
    $c = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | ForEach-Object { $_.Culture.Name })
    Out @{ event = 'check'; cultures = $c }
    exit 0
  }
  $ci = New-Object System.Globalization.CultureInfo($Culture)
  $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine($ci)
  $rec.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $rec.SetInputToDefaultAudioDevice()
  Out @{ event = 'ready' }
  $r = $rec.Recognize([TimeSpan]::FromSeconds($TimeoutSec))
  if ($r -and $r.Text) { Out @{ event = 'result'; text = $r.Text } } else { Out @{ event = 'timeout' } }
} catch {
  Out @{ event = 'error'; message = $_.Exception.Message }
}