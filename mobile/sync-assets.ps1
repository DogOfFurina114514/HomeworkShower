# 把网页端 docs/ 原样同步到 Android 的 assets/site/（内置一份与网页端相同的页面）
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path (Split-Path -Parent $here) 'docs'
$dst = Join-Path $here 'app\src\main\assets\site'

if (-not (Test-Path $src)) { throw "找不到网页端目录: $src" }
New-Item -ItemType Directory -Force -Path $dst | Out-Null
robocopy $src $dst /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
$files = (Get-ChildItem $dst -Recurse -File).Count
$size = [math]::Round(((Get-ChildItem $dst -Recurse -File | Measure-Object Length -Sum).Sum / 1KB))
Write-Output "已同步 $files 个文件（$size KB）到 assets/site"
