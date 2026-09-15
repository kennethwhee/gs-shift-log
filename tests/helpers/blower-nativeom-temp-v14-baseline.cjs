'use strict';
const crypto = require('node:crypto');
const reviewedCompilerSource = "function Test-ProbeNativeOmCompileLock([object[]]$Records, [string]$CompileDirectory) {\n  $messages = New-Object System.Collections.Generic.List[string]\n  foreach ($record in @($Records)) {\n    if ($null -eq $record) { continue }\n    $messages.Add([string]$record)\n    if ($record -is [Management.Automation.ErrorRecord]) {\n      if ($null -ne $record.ErrorDetails) { $messages.Add([string]$record.ErrorDetails.Message) }\n      $exception = $record.Exception\n      while ($null -ne $exception) {\n        $messages.Add([string]$exception.Message)\n        $exception = $exception.InnerException\n      }\n      $target = $record.TargetObject\n      if ($null -ne $target) {\n        foreach ($property in @(\"ErrorNumber\", \"ErrorText\")) {\n          if ($null -ne $target.PSObject.Properties[$property]) { $messages.Add([string]$target.$property) }\n        }\n      }\n    }\n  }\n  $diagnostic = $messages -join \" \"\n  $codes = @([regex]::Matches($diagnostic, '(?i)\\bCS[0-9]{4}\\b') | ForEach-Object { $_.Value.ToUpperInvariant() })\n  if ($codes.Count -eq 0 -or @($codes | Where-Object { $_ -ne \"CS0016\" }).Count -gt 0) { return $false }\n  if ($diagnostic -match '(?i)access\\s+(?:is\\s+)?denied|액세스[^.]*거부|권한[^.]*없') { return $false }\n  $directoryPrefix = [IO.Path]::GetFullPath($CompileDirectory).TrimEnd('\\') + '\\'\n  if ($diagnostic.IndexOf($directoryPrefix, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or $diagnostic -notmatch '(?i)\\.dll\\b') { return $false }\n  return ($diagnostic -match '(?i)(?:being\\s+)?used\\s+by\\s+another\\s+process|sharing\\s+violation|lock\\s+violation|다른\\s*프로세스[^.]*사용')\n}\n\nfunction Initialize-ProbeNativeOm([string]$TypeDefinition) {\n  $createdDirectories = New-Object System.Collections.Generic.List[string]\n  $retryWaits = @(1000, 2000)\n  try {\n    for ($attempt = 0; $attempt -lt 3; $attempt += 1) {\n      $compileDirectory = Join-Path ([IO.Path]::GetTempPath()) (\"gs-blower-nativeom-\" + [Guid]::NewGuid().ToString(\"N\"))\n      if (Test-Path -LiteralPath $compileDirectory) { throw \"Excel 연결모듈 임시 폴더가 이미 존재합니다.\" }\n      [void][IO.Directory]::CreateDirectory($compileDirectory)\n      $createdDirectories.Add($compileDirectory)\n      $parameters = New-Object System.CodeDom.Compiler.CompilerParameters\n      $parameters.GenerateInMemory = $true\n      $parameters.GenerateExecutable = $false\n      $parameters.IncludeDebugInformation = $false\n      $parameters.TempFiles = [System.CodeDom.Compiler.TempFileCollection]::new($compileDirectory, $false)\n      [void]$parameters.ReferencedAssemblies.Add(\"System.dll\")\n      $compileErrors = @()\n      try {\n        Write-ProbeStage (\"Excel 연결모듈 준비 · \" + [string]($attempt + 1) + \"/3\")\n        Add-Type -TypeDefinition $TypeDefinition -CompilerParameters $parameters -ErrorVariable +compileErrors -ErrorAction Stop\n        return\n      } catch {\n        if ($attempt -ge 2 -or -not (Test-ProbeNativeOmCompileLock (@($compileErrors) + @($_)) $compileDirectory)) { throw }\n        Write-ProbeStage \"Excel 연결모듈 임시 DLL 잠금 · 잠시 후 다시 준비\"\n        Start-Sleep -Milliseconds $retryWaits[$attempt]\n      }\n    }\n  } finally {\n    foreach ($directory in $createdDirectories) {\n      try {\n        if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction Stop }\n      } catch {\n        try { Write-ProbeStage (\"Excel 연결모듈 임시 폴더 정리 대기: \" + $directory) } catch {}\n      }\n    }\n  }\n}\n";
const reviewedCompilerSha256 = 'c2adc0e27440480bdb01b8dde54bd5859afb117b2b8707ac097d229367782fce';
const candidateCompilerSha256 = 'f782fdafe230f8de6d1ec18b2dd79b854a1513b3244a30259369b576cc9b2ced';
const reviewedV13AgentSha256 = '6ed489f20cafafac24d671d045532bc5e72a7283e4f65e908815104e55b414c5';
const start = 'function Test-ProbeNativeOmCompileLock(';
const initializer = '\nfunction Initialize-ProbeNativeOm(';
const end = '\n}\n';
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function compilerBlocks(source) {
  const blocks = [];
  let at = source.indexOf(start);
  while (at >= 0) {
    const init = source.indexOf(initializer, at);
    const close = init < 0 ? -1 : source.indexOf(end, init);
    const to = close < 0 ? -1 : close + end.length;
    if (to < 0) throw new Error('Compiler helper terminator is missing');
    blocks.push({ from: at, to, text: source.slice(at, to) });
    at = source.indexOf(start, to);
  }
  if (blocks.length !== 2) throw new Error('Expected exactly two Blower compiler helper blocks');
  return blocks;
}
function restoreReviewedCompilerSource(source) {
  if (hash(reviewedCompilerSource) !== reviewedCompilerSha256) throw new Error('Reviewed compiler baseline changed');
  const blocks = compilerBlocks(source);
  for (const block of blocks) {
    if (hash(block.text) !== candidateCompilerSha256) throw new Error('Unreviewed compiler helper bytes');
  }
  for (const block of blocks.reverse()) source = source.slice(0, block.from) + reviewedCompilerSource + source.slice(block.to);
  return source;
}
module.exports = { restoreReviewedCompilerSource, compilerBlocks, reviewedV13AgentSha256, reviewedCompilerSha256, candidateCompilerSha256 };
