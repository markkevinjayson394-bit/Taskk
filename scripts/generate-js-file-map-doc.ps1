[CmdletBinding()]
param(
  [string]$OutputDocx = "output/doc/js-file-map.docx",
  [string]$OutputMarkdown = "output/doc/js-file-map.md",
  [switch]$SkipDocx
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-CommandExists {
  param([Parameter(Mandatory = $true)][string]$Name)
  return $null -ne (Get-Command -Name $Name -ErrorAction SilentlyContinue)
}

function Get-RelativeUnixPath {
  param(
    [Parameter(Mandatory = $true)][string]$BaseDir,
    [Parameter(Mandatory = $true)][string]$FullPath
  )

  $base = (Resolve-Path -LiteralPath $BaseDir).Path
  $full = (Resolve-Path -LiteralPath $FullPath).Path

  if ($base[-1] -ne [System.IO.Path]::DirectorySeparatorChar) {
    $base = $base + [System.IO.Path]::DirectorySeparatorChar
  }

  $baseUri = New-Object System.Uri($base)
  $fullUri = New-Object System.Uri($full)
  $rel = [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($fullUri).ToString())
  return ($rel -replace "\\", "/")
}

function Get-SourceFiles {
  param([Parameter(Mandatory = $true)][string]$RepoRoot)

  $disallowedPrefix = @(
    "node_modules/",
    "android/",
    "ios/",
    "coverage/",
    "dist/",
    "docs/",
    ".expo/"
  )

  $tracked = @()
  if (Test-CommandExists -Name "git") {
    try {
      $tracked = @(git -C $RepoRoot ls-files 2>$null)
    } catch {
      $tracked = @()
    }
  }

  if ($tracked.Count -gt 0) {
    $candidates = $tracked |
      Where-Object { $_ -match "\.(js|jsx|ts|tsx)$" } |
      Where-Object {
        $path = $_ -replace "\\", "/"
        foreach ($prefix in $disallowedPrefix) {
          if ($path.StartsWith($prefix)) {
            return $false
          }
        }
        return $true
      } |
      ForEach-Object { Join-Path $RepoRoot $_ }
  } else {
    $candidates = Get-ChildItem -Path $RepoRoot -Recurse -File |
      Where-Object { $_.Extension -in @(".js", ".jsx", ".ts", ".tsx") } |
      Where-Object {
        $rel = Get-RelativeUnixPath -BaseDir $RepoRoot -FullPath $_.FullName
        foreach ($prefix in $disallowedPrefix) {
          if ($rel.StartsWith($prefix)) {
            return $false
          }
        }
        return $true
      } |
      ForEach-Object { $_.FullName }
  }

  # De-duplicate by normalized relative path so each file appears once.
  $seen = [System.Collections.Generic.HashSet[string]]::new()
  $result = [System.Collections.Generic.List[object]]::new()
  foreach ($fullPath in $candidates) {
    if (-not (Test-Path -LiteralPath $fullPath)) {
      continue
    }
    $rel = Get-RelativeUnixPath -BaseDir $RepoRoot -FullPath $fullPath
    if ($seen.Add($rel)) {
      $result.Add([PSCustomObject]@{
          RelativePath = $rel
          FullPath     = (Resolve-Path -LiteralPath $fullPath).Path
        })
    }
  }

  return $result | Sort-Object RelativePath
}

function Get-ScopedHeadingMap {
  param([Parameter(Mandatory = $true)][array]$RelativePaths)

  $byBase = @{}
  foreach ($rel in $RelativePaths) {
    $base = [System.IO.Path]::GetFileName($rel)
    if (-not $byBase.ContainsKey($base)) {
      $byBase[$base] = [System.Collections.Generic.List[string]]::new()
    }
    $null = $byBase[$base].Add($rel)
  }

  $headingMap = @{}
  foreach ($baseName in $byBase.Keys) {
    $group = @($byBase[$baseName])
    if ($group.Count -eq 1) {
      $headingMap[$group[0]] = $baseName
      continue
    }

    $segmentsMap = @{}
    foreach ($rel in $group) {
      $segmentsMap[$rel] = @($rel.Split("/"))
    }

    $maxSegments = ($segmentsMap.Values | ForEach-Object { $_.Count } | Measure-Object -Maximum).Maximum
    $resolved = $false

    for ($depth = 2; $depth -le $maxSegments; $depth++) {
      $suffixes = @{}
      $isUnique = $true

      foreach ($rel in $group) {
        $segments = $segmentsMap[$rel]
        $take = [Math]::Min($depth, $segments.Count)
        $start = $segments.Count - $take
        $suffix = ($segments[$start..($segments.Count - 1)] -join "/")

        if ($suffixes.ContainsKey($suffix)) {
          $isUnique = $false
          break
        }
        $suffixes[$suffix] = $rel
      }

      if ($isUnique) {
        foreach ($suffix in $suffixes.Keys) {
          $rel = $suffixes[$suffix]
          $headingMap[$rel] = $suffix
        }
        $resolved = $true
        break
      }
    }

    if (-not $resolved) {
      foreach ($rel in $group) {
        $headingMap[$rel] = $rel
      }
    }
  }

  return $headingMap
}

function Get-CodeLanguage {
  param([Parameter(Mandatory = $true)][string]$Path)
  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".ts" { return "ts" }
    ".tsx" { return "tsx" }
    ".jsx" { return "jsx" }
    default { return "js" }
  }
}

$repoRoot = (Get-Location).Path
$files = @(Get-SourceFiles -RepoRoot $repoRoot)

if ($files.Count -eq 0) {
  throw "No source files found for export."
}

$headingMap = Get-ScopedHeadingMap -RelativePaths ($files | ForEach-Object { $_.RelativePath })

$sections = foreach ($f in $files) {
  $content = Get-Content -LiteralPath $f.FullPath -Raw
  [PSCustomObject]@{
    heading = $headingMap[$f.RelativePath]
    path    = $f.RelativePath
    lang    = Get-CodeLanguage -Path $f.RelativePath
    code    = $content
  }
}

$mdOutPath = Join-Path $repoRoot $OutputMarkdown
$mdOutDir = Split-Path -Path $mdOutPath -Parent
if (-not (Test-Path -LiteralPath $mdOutDir)) {
  New-Item -Path $mdOutDir -ItemType Directory -Force | Out-Null
}

$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine("# JS/TS File Map")
[void]$sb.AppendLine()
[void]$sb.AppendLine('_Generated by `scripts/generate-js-file-map-doc.ps1`_')
[void]$sb.AppendLine()

foreach ($s in $sections) {
  [void]$sb.AppendLine("## $($s.heading)")
  [void]$sb.AppendLine()
  [void]$sb.AppendLine(('Path: "{0}"' -f $s.path))
  [void]$sb.AppendLine()
  [void]$sb.AppendLine(('```{0}' -f $s.lang))
  [void]$sb.AppendLine($s.code.TrimEnd())
  [void]$sb.AppendLine('```')
  [void]$sb.AppendLine()
}

[System.IO.File]::WriteAllText($mdOutPath, $sb.ToString(), [System.Text.Encoding]::UTF8)
Write-Host "Markdown export written: $mdOutPath"

if ($SkipDocx) {
  Write-Host 'DOCX export skipped (-SkipDocx).'
  exit 0
}

if (-not (Test-CommandExists -Name "python")) {
  Write-Warning "Python not found. DOCX export skipped. Markdown output is available at $mdOutPath"
  exit 0
}

$docxOutPath = Join-Path $repoRoot $OutputDocx
$docxOutDir = Split-Path -Path $docxOutPath -Parent
if (-not (Test-Path -LiteralPath $docxOutDir)) {
  New-Item -Path $docxOutDir -ItemType Directory -Force | Out-Null
}

$tmpJsonPath = Join-Path $env:TEMP ("js-file-map-sections-" + [Guid]::NewGuid().ToString("N") + ".json")
$tmpPyPath = Join-Path $env:TEMP ("js-file-map-docx-" + [Guid]::NewGuid().ToString("N") + ".py")

$payload = [PSCustomObject]@{
  output_docx = $docxOutPath
  sections    = $sections
}

[System.IO.File]::WriteAllText(
  $tmpJsonPath,
  ($payload | ConvertTo-Json -Depth 8),
  [System.Text.Encoding]::UTF8
)

$pyScript = @"
import json
import sys
from pathlib import Path

try:
    from docx import Document
    from docx.shared import Pt
except Exception:
    sys.stderr.write("python-docx is required. Install with: pip install python-docx\n")
    raise

json_path = Path(sys.argv[1])
data = json.loads(json_path.read_text(encoding="utf-8"))

doc = Document()
doc.add_heading("JS/TS File Map", level=0)

for section in data["sections"]:
    doc.add_heading(section["heading"], level=2)
    p = doc.add_paragraph(section["path"])
    if p.runs:
        p.runs[0].italic = True
    code = doc.add_paragraph(section["code"])
    for run in code.runs:
        run.font.name = "Consolas"
        run.font.size = Pt(9)

output_path = Path(data["output_docx"])
output_path.parent.mkdir(parents=True, exist_ok=True)
doc.save(str(output_path))
"@

[System.IO.File]::WriteAllText($tmpPyPath, $pyScript, [System.Text.Encoding]::UTF8)

try {
  & python $tmpPyPath $tmpJsonPath
  Write-Host "DOCX export written: $docxOutPath"
} finally {
  Remove-Item -LiteralPath $tmpJsonPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $tmpPyPath -Force -ErrorAction SilentlyContinue
}



