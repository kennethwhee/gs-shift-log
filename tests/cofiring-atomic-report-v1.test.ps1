param(
  [Parameter(Mandatory=$true)][string]$WorkerPath
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
if ($env:OS -ne 'Windows_NT' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -lt 1) {
  throw 'Run this file with Windows PowerShell 5.1.'
}

# Parse the real staged worker, then load ONLY these two function definitions.
# The worker body, Excel, DataPARC, Agent and production files are never executed.
$tokens=$null;$parseErrors=$null
$workerAst=[Management.Automation.Language.Parser]::ParseFile($WorkerPath,[ref]$tokens,[ref]$parseErrors)
if (@($parseErrors).Count -gt 0) { throw 'The staged worker has PowerShell parse errors.' }
foreach ($functionName in @('Test-CofiringAtomicSharingError','Write-CofiringJsonAtomic')) {
  $definitions=@($workerAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $functionName},$true))
  if ($definitions.Count -ne 1) { throw ('Expected one actual worker function: '+$functionName) }
  . ([scriptblock]::Create($definitions[0].Extent.Text))
}

function Assert-AtomicTest([bool]$Condition,[string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Read-AtomicText([string]$Path) { return [IO.File]::ReadAllText($Path,[Text.Encoding]::UTF8) }
function Get-AtomicSiblingFiles([string]$Path) {
  # Win32 treats the trailing dot in 'values.json.*' as optional and can return
  # values.json itself. Enumerate first, then compare the literal leaf prefix.
  $directory=[IO.Path]::GetDirectoryName($Path)
  $prefix=[IO.Path]::GetFileName($Path)+'.'
  foreach ($candidate in [IO.Directory]::GetFiles($directory)) {
    if ([IO.Path]::GetFileName($candidate).StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { $candidate }
  }
}
function Assert-NoAtomicSiblingFiles([string]$Path,[string]$Message) {
  $siblings=@(Get-AtomicSiblingFiles $Path)
  if ($siblings.Count -gt 0) {
    $names=@($siblings | ForEach-Object { [IO.Path]::GetFileName($_) })
    throw ($Message+' Remaining files: '+($names -join ', '))
  }
}
function Invoke-AtomicTest([string]$Name,[scriptblock]$Body) {
  try { & $Body; $script:passedTests+=1; Write-Host ('PASS: '+$Name) }
  catch { $script:failedTests+=1; Write-Host ('FAIL: '+$Name+' -- '+$_.Exception.Message) }
}

$temporaryRoot=Join-Path ([IO.Path]::GetTempPath()) ('gs-cofiring-atomic-test-'+[Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($temporaryRoot)
$passedTests=0;$failedTests=0
try {
  Invoke-AtomicTest 'literal sibling inspection excludes the destination and detects real leftover files' {
    $file=Join-Path $temporaryRoot 'inspection[1].json'
    $lookalike=Join-Path $temporaryRoot 'inspection1.json.unrelated.new'
    $similar=$file+'-copy.new'
    $directory=$file+'.directory'
    [IO.File]::WriteAllText($file,'destination must stay untouched')
    [IO.File]::WriteAllText($lookalike,'wildcard lookalike must stay untouched')
    [IO.File]::WriteAllText($similar,'similar prefix must stay untouched')
    [void][IO.Directory]::CreateDirectory($directory)
    Assert-NoAtomicSiblingFiles $file 'The destination, lookalike or directory was miscounted.'

    $newFile=$file+'.'+[Guid]::NewGuid().ToString('N')+'.new'
    $previousFile=Join-Path $temporaryRoot ('INSPECTION[1].JSON.'+[Guid]::NewGuid().ToString('N')+'.previous')
    [IO.File]::WriteAllText($newFile,'uncommitted candidate')
    [IO.File]::WriteAllText($previousFile,'backup candidate')
    $siblings=@(Get-AtomicSiblingFiles $file)
    Assert-AtomicTest ($siblings.Count -eq 2 -and $siblings -contains $newFile -and $siblings -contains $previousFile) 'Real .new or .previous files were missed.'
    $failure=$null
    try { Assert-NoAtomicSiblingFiles $file 'Deliberate leftover files.' } catch { $failure=$_ }
    Assert-AtomicTest ($null -ne $failure) 'The cleanup assertion accepted real leftover files.'
    Assert-AtomicTest ($failure.Exception.Message.Contains([IO.Path]::GetFileName($newFile)) -and $failure.Exception.Message.Contains([IO.Path]::GetFileName($previousFile))) 'The cleanup failure omitted the remaining file names.'
    Assert-AtomicTest ((Read-AtomicText $newFile) -ceq 'uncommitted candidate') 'Inspection changed the candidate file.'
    Assert-AtomicTest ((Read-AtomicText $previousFile) -ceq 'backup candidate') 'Inspection changed the backup file.'
    [IO.File]::Delete($newFile);[IO.File]::Delete($previousFile)
    Assert-NoAtomicSiblingFiles $file 'Removed candidates were still counted.'
    Assert-AtomicTest ((Read-AtomicText $file) -ceq 'destination must stay untouched') 'Inspection changed the destination.'
    Assert-AtomicTest ((Read-AtomicText $lookalike) -ceq 'wildcard lookalike must stay untouched') 'Inspection changed the lookalike.'
    Assert-AtomicTest ((Read-AtomicText $similar) -ceq 'similar prefix must stay untouched') 'Inspection changed the similar file.'
    Assert-AtomicTest ([IO.Directory]::Exists($directory)) 'Inspection changed the sibling directory.'
  }

  Invoke-AtomicTest 'first creation and repeated replacement preserve JSON values and UTF-8' {
    $file=Join-Path $temporaryRoot 'values.json'
    for ($index=0;$index -lt 12;$index+=1) {
      $value=[ordered]@{index=$index;count=[long]639247798553530172;fraction=1.25;empty=$null;ready=$true;label=([string][char]0xD55C+[char]0xAE00);nested=@{items=@(1,2,3)}}
      Write-CofiringJsonAtomic $file $value
      $text=Read-AtomicText $file
      $actual=ConvertFrom-Json -InputObject $text
      Assert-AtomicTest ($text.Contains('"count":639247798553530172')) 'Int64 digits were rounded during JSON serialization.'
      Assert-AtomicTest ($actual.index -eq $index -and [long]$actual.count -eq [long]639247798553530172) 'Integer JSON values changed.'
      Assert-AtomicTest ($actual.fraction -eq 1.25 -and $null -eq $actual.empty -and $actual.ready -eq $true) 'Scalar JSON values changed.'
      Assert-AtomicTest ($actual.label -eq $value.label -and @($actual.nested.items).Count -eq 3) 'Unicode or nested JSON changed.'
    }
    $bytes=[IO.File]::ReadAllBytes($file)
    Assert-AtomicTest (-not ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191)) 'JSON unexpectedly has a UTF-8 BOM.'
    Assert-NoAtomicSiblingFiles $file 'Completed writes left temporary sibling files.'
  }

  Invoke-AtomicTest 'a reader holding the legacy previous backup does not block a new write' {
    $file=Join-Path $temporaryRoot 'legacy.json';$legacy=$file+'.previous';$foreign=$file+'.unrelated.new'
    Write-CofiringJsonAtomic $file @{revision=1}
    [IO.File]::WriteAllText($legacy,'legacy backup must stay untouched')
    [IO.File]::WriteAllText($foreign,'unrelated file must stay untouched')
    $reader=[IO.File]::Open($legacy,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
    try { Write-CofiringJsonAtomic $file @{revision=2} } finally { $reader.Dispose() }
    Assert-AtomicTest ((ConvertFrom-Json -InputObject (Read-AtomicText $file)).revision -eq 2) 'The replacement did not commit.'
    Assert-AtomicTest ((Read-AtomicText $legacy) -eq 'legacy backup must stay untouched') 'The legacy backup was changed.'
    Assert-AtomicTest ((Read-AtomicText $foreign) -eq 'unrelated file must stay untouched') 'An unrelated sibling was changed.'
  }

  Invoke-AtomicTest 'a genuine Windows destination lock released by a runspace is recovered' {
    $file=Join-Path $temporaryRoot 'transient.json';Write-CofiringJsonAtomic $file @{revision=1}
    $state=[hashtable]::Synchronized(@{Ready=$false;BeginWrite=$false;Released=$false})
    $locker=[powershell]::Create();$invocation=$null
    try {
      [void]$locker.AddScript({param($file,$state)
        $ErrorActionPreference='Stop'
        $reader=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        try {
          $state.Ready=$true
          $wait=[Diagnostics.Stopwatch]::StartNew()
          while (-not $state.BeginWrite -and $wait.ElapsedMilliseconds -lt 5000) { Start-Sleep -Milliseconds 10 }
          if (-not $state.BeginWrite) { throw 'The writer did not start.' }
          Start-Sleep -Milliseconds 400
        } finally { $reader.Dispose();$state.Released=$true }
      }).AddArgument($file).AddArgument($state)
      $invocation=$locker.BeginInvoke()
      $readyClock=[Diagnostics.Stopwatch]::StartNew()
      while (-not $state.Ready -and -not $invocation.IsCompleted -and $readyClock.ElapsedMilliseconds -lt 5000) { Start-Sleep -Milliseconds 10 }
      Assert-AtomicTest ([bool]$state.Ready -and -not [bool]$state.Released) 'Could not acquire the controlled reader lock.'
      $clock=[Diagnostics.Stopwatch]::StartNew();$state.BeginWrite=$true
      Write-CofiringJsonAtomic $file @{revision=2}
      $elapsed=$clock.ElapsedMilliseconds
      [void]$locker.EndInvoke($invocation);$invocation=$null
      Assert-AtomicTest ($locker.Streams.Error.Count -eq 0 -and [bool]$state.Released) 'The lock release runspace failed.'
      Assert-AtomicTest ($elapsed -ge 150 -and $elapsed -lt 5000) 'The controlled transient lock was not retried within the bound.'
      Assert-AtomicTest ((ConvertFrom-Json -InputObject (Read-AtomicText $file)).revision -eq 2) 'The recovered write did not commit.'
      Assert-NoAtomicSiblingFiles $file 'The recovered write left temporary files.'
    } finally {
      $state.BeginWrite=$true
      if ($null -ne $invocation -and -not $invocation.IsCompleted) { try { $locker.Stop() } catch { } }
      $locker.Dispose()
    }
  }

  Invoke-AtomicTest 'a persistent Windows lock fails within the retry budget and preserves old bytes' {
    $file=Join-Path $temporaryRoot 'persistent.json';Write-CofiringJsonAtomic $file @{revision=1;keep='original'}
    $before=Read-AtomicText $file
    $reader=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $failure=$null;$clock=[Diagnostics.Stopwatch]::StartNew()
    try { try { Write-CofiringJsonAtomic $file @{revision=2} } catch { $failure=$_ } }
    finally { $reader.Dispose() }
    $elapsed=$clock.ElapsedMilliseconds
    Assert-AtomicTest ($null -ne $failure) 'The persistent lock unexpectedly succeeded.'
    Assert-AtomicTest (Test-CofiringAtomicSharingError $failure.Exception) 'The original sharing error was lost.'
    Assert-AtomicTest ($elapsed -ge 1200 -and $elapsed -lt 6000) 'The persistent lock did not obey the bounded retry.'
    Assert-AtomicTest ((Read-AtomicText $file) -ceq $before) 'A failed write changed the old destination bytes.'
    Assert-NoAtomicSiblingFiles $file 'A failed uncommitted write left temporary siblings.'
  }

  Invoke-AtomicTest 'an unrelated permanent write error is not retried and keeps existing data' {
    $directory=Join-Path $temporaryRoot 'destination-directory';[void][IO.Directory]::CreateDirectory($directory)
    $sentinel=Join-Path $directory 'original.txt';[IO.File]::WriteAllText($sentinel,'unchanged')
    $failure=$null;$clock=[Diagnostics.Stopwatch]::StartNew()
    try { Write-CofiringJsonAtomic $directory @{revision=2} } catch { $failure=$_ }
    Assert-AtomicTest ($null -ne $failure) 'A directory was incorrectly accepted as a file destination.'
    Assert-AtomicTest (-not (Test-CofiringAtomicSharingError $failure.Exception)) 'A permanent error was classified as a lock.'
    Assert-AtomicTest ($clock.ElapsedMilliseconds -lt 1200) 'A permanent error unnecessarily waited through retries.'
    Assert-AtomicTest ((Read-AtomicText $sentinel) -ceq 'unchanged') 'The permanent failure changed unrelated existing data.'
    Assert-NoAtomicSiblingFiles $directory 'The permanent failure left its temporary sibling.'
  }

  Invoke-AtomicTest 'only sharing and lock violation HRESULTs are retryable, including wrapped errors' {
    $sharing=[IO.IOException]::new('sharing',[int]-2147024864)
    $locked=[IO.IOException]::new('locked',[int]-2147024863)
    $denied=[IO.IOException]::new('access denied',[int]-2147024891)
    Assert-AtomicTest (Test-CofiringAtomicSharingError $sharing) 'Sharing violation was not recognized.'
    Assert-AtomicTest (Test-CofiringAtomicSharingError ([Exception]::new('outer',$locked))) 'Wrapped lock violation was not recognized.'
    Assert-AtomicTest (-not (Test-CofiringAtomicSharingError $denied)) 'Access denied was wrongly classified as transient.'
    Assert-AtomicTest (-not (Test-CofiringAtomicSharingError ([Exception]::new('file is used by another process')))) 'An error message alone became retryable.'
  }
} finally {
  try { if ([IO.Directory]::Exists($temporaryRoot)) { [IO.Directory]::Delete($temporaryRoot,$true) } }
  catch { $failedTests+=1;Write-Host ('FAIL: temporary test cleanup -- '+$_.Exception.Message) }
}
Write-Host ('Atomic report tests: '+$passedTests+' passed, '+$failedTests+' failed. No Excel, Agent or DataPARC operation was performed.')
if ($failedTests -gt 0) { exit 1 }
exit 0
