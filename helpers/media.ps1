# Desktop Companion - media helper.
# Talks to Windows' Global System Media Transport Controls (the same sessions the
# volume/media flyout shows) and streams JSON lines to stdout:
#   {"type":"state", ...}  whenever playback state / track / timeline changes
#   {"type":"art", ...}    album art (base64) when the track changes
# Commands arrive on stdin, one per line: toggle | next | prev | seek:<ms>
# Exit codes: 3 = media API unavailable (don't restart).
param([int]$ParentPid = 0, [int]$AnyApp = 0)

[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
} catch {
  [Console]::Out.WriteLine('{"error":"winrt-unavailable"}'); [Console]::Out.Flush(); exit 3
}
$ErrorActionPreference = 'SilentlyContinue'

$opName = 'IAsyncOperation' + [char]96 + '1'
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq $opName } |
  Select-Object -First 1

function Await($op, [Type]$type) {
  if ($null -eq $op) { return $null }
  try {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    if (-not $task.Wait(3000)) { return $null }
    return $task.Result
  } catch { return $null }
}

function Emit($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 3)); [Console]::Out.Flush()
}

$mgrType   = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
$null = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))

$mgr = Await ($mgrType::RequestAsync()) $mgrType
if (-not $mgr) { [Console]::Out.WriteLine('{"error":"no-session-manager"}'); [Console]::Out.Flush(); exit 3 }

function Get-Session {
  $sessions = @($mgr.GetSessions())
  $spotify = @($sessions | Where-Object { $_.SourceAppUserModelId -match 'spotify' })
  if ($AnyApp -eq 0) { return $spotify | Select-Object -First 1 }
  $playing = @($sessions | Where-Object { $_.GetPlaybackInfo().PlaybackStatus -eq 'Playing' })
  $p = $playing | Where-Object { $_.SourceAppUserModelId -match 'spotify' } | Select-Object -First 1
  if ($p) { return $p }
  if ($playing.Count) { return $playing[0] }
  if ($spotify.Count) { return $spotify[0] }
  return $mgr.GetCurrentSession()
}

function Send-Art($props, [string]$key) {
  $out = [ordered]@{ type = 'art'; key = $key; mime = ''; b64 = '' }
  try {
    if ($props -and $props.Thumbnail) {
      $st = Await ($props.Thumbnail.OpenReadAsync()) $streamType
      if ($st) {
        # PowerShell can't cast the raw WinRT stream, but reflection's argument
        # binding QueryInterfaces it to IInputStream for us.
        $net = $asStreamForRead.Invoke($null, @($st))
        $ms = New-Object System.IO.MemoryStream
        $net.CopyTo($ms); $net.Dispose()
        if ($ms.Length -gt 0 -and $ms.Length -lt 3000000) {
          $out.b64 = [Convert]::ToBase64String($ms.ToArray())
        }
      }
    }
  } catch {}
  Emit $out
}

# Console.In.ReadLineAsync is synchronous on .NET Framework; a StreamReader over
# the raw stdin stream gives a genuinely async read we can poll.
$stdin = New-Object System.IO.StreamReader ([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$lastJson = ''
$lastKey = $null
$artRetryAt = [DateTime]::MaxValue
$nextPoll = [DateTime]::MinValue

while ($true) {
  $force = $false
  if ($pending.IsCompleted) {
    $cmd = $pending.Result
    if ($null -eq $cmd) { exit 0 }          # stdin closed: parent is gone
    $s = Get-Session
    if ($s) {
      switch -regex ($cmd.Trim()) {
        '^toggle$'      { $null = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
        '^next$'        { $null = Await ($s.TrySkipNextAsync()) ([bool]) }
        '^prev$'        { $null = Await ($s.TrySkipPreviousAsync()) ([bool]) }
        '^seek:(\d+)$'  { $null = Await ($s.TryChangePlaybackPositionAsync([long]$matches[1] * 10000)) ([bool]) }
      }
    }
    $pending = $stdin.ReadLineAsync()
    $force = $true
    Start-Sleep -Milliseconds 150            # give the player a moment to update
  }

  $now = Get-Date
  if ($force -or $now -ge $nextPoll) {
    $nextPoll = $now.AddMilliseconds(900)
    if ($ParentPid -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit 0 }

    $s = Get-Session
    $props = $null
    if (-not $s) {
      $state = [ordered]@{ type = 'state'; state = 'none'; key = '' }
    } else {
      $info = $s.GetPlaybackInfo()
      $props = Await ($s.TryGetMediaPropertiesAsync()) $propsType
      $tl = $s.GetTimelineProperties()
      $upd = 0
      try { $upd = $tl.LastUpdatedTime.ToUnixTimeMilliseconds() } catch {}
      $state = [ordered]@{
        type   = 'state'
        state  = [string]$info.PlaybackStatus
        app    = [string]$s.SourceAppUserModelId
        title  = [string]$props.Title
        artist = [string]$props.Artist
        album  = [string]$props.AlbumTitle
        pos    = [long][math]::Round($tl.Position.TotalMilliseconds)
        dur    = [long][math]::Round(($tl.EndTime - $tl.StartTime).TotalMilliseconds)
        upd    = $upd
        next   = [bool]$info.Controls.IsNextEnabled
        prev   = [bool]$info.Controls.IsPreviousEnabled
        key    = "$($props.Title)|$($props.Artist)|$($props.AlbumTitle)"
      }
    }

    $json = $state | ConvertTo-Json -Compress
    if ($json -ne $lastJson) { $lastJson = $json; [Console]::Out.WriteLine($json); [Console]::Out.Flush() }

    # Art goes out after the state so the renderer already knows the new track key.
    if ($state.key -ne $lastKey) {
      $lastKey = $state.key
      if ($s) { Send-Art $props $state.key; $artRetryAt = $now.AddMilliseconds(2000) }
    } elseif ($s -and $now -ge $artRetryAt) {
      # Some players publish the new cover a beat after the new title.
      $artRetryAt = [DateTime]::MaxValue
      Send-Art $props $state.key
    }
  }
  Start-Sleep -Milliseconds 120
}
