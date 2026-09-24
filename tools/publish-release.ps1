# 发布 APK 到 GitHub Release（不依赖 gh CLI）
#
# 用法：
#   pwsh -NoProfile -File tools/publish-release.ps1 -Tag 26.0.0 -Apk <apk路径> [-Repo owner/name] [-Notes "说明"] [-Force]
#
# 说明：
#   * tag 不存在时会自动基于默认分支最新提交创建同名 tag；
#   * -Force 会先删掉同名 Release 再重建（覆盖资产）；
#   * 代理：默认走 http://127.0.0.1:26561（Watt Toolkit），可用 -Proxy "" 关掉。

param(
  [Parameter(Mandatory = $true)][string]$Tag,
  [Parameter(Mandatory = $true)][string]$Apk,
  [string]$Repo = "DogOfFurina114514/HomeworkShower",
  [string]$Notes = "",
  [string]$Name = "",
  [string]$Proxy = "http://127.0.0.1:26561",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$tokenFile = "F:\DeepSeekHarness\Workspace\wmessage-token.txt"
$token = (Get-Content $tokenFile -Raw).Trim()
if (-not $token) { throw "读不到 GitHub token：$tokenFile" }
if (-not (Test-Path $Apk)) { throw "找不到 APK：$Apk" }

$headers = @{
  Authorization          = "Bearer $token"
  "User-Agent"           = "HomeworkShower-Release"
  Accept                 = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
}
$proxyArgs = @{}
if ($Proxy) { $proxyArgs["Proxy"] = $Proxy }

function Invoke-GitHub {
  param([string]$Method, [string]$Uri, $Body)
  $params = @{ Method = $Method; Uri = $Uri; Headers = $headers; TimeoutSec = 120 } + $proxyArgs
  if ($Body) {
    $params["Body"] = ($Body | ConvertTo-Json -Depth 6)
    $params["ContentType"] = "application/json"
  }
  return Invoke-RestMethod @params
}

$api = "https://api.github.com/repos/$Repo"
$apkName = Split-Path $Apk -Leaf
$apkSize = (Get-Item $Apk).Length
Write-Output "发布：$Repo  tag=$Tag  资产=$apkName（$([Math]::Round($apkSize / 1MB, 2)) MB）"

# 1) 同名 Release 处理
$existing = $null
try {
  $existing = Invoke-GitHub -Method Get -Uri "$api/releases/tags/$Tag"
} catch {
  $existing = $null
}
if ($existing) {
  if (-not $Force) { throw "Release $Tag 已存在（加 -Force 覆盖）" }
  Write-Output "删除已存在的 Release $Tag（id=$($existing.id)）"
  Invoke-GitHub -Method Delete -Uri "$api/releases/$($existing.id)" | Out-Null
  $existing = $null
}

# 2) 创建 Release（tag 不存在时 GitHub 会基于默认分支创建）
$releaseName = if ($Name) { $Name } else { "HomeworkShower $Tag" }
if (-not $Notes) { $Notes = "HomeworkShower $Tag" }
$release = Invoke-GitHub -Method Post -Uri "$api/releases" -Body @{
  tag_name         = $Tag
  target_commitish = "main"
  name             = $releaseName
  body             = $Notes
  draft            = $false
  prerelease       = $false
}
Write-Output "Release 已创建：$($release.html_url)"

# 3) 上传资产（用 curl 以二进制方式发送，并立刻核对服务端记录的大小）
#
# 为什么不用 PowerShell 的 HttpClient/multipart：这条链路上曾出现过二进制被按
# 文本转发的情况（上传后资产比本地多 264 字节、文件头从 PK\x03\x04 变成别的东西），
# 用户下载后安装会报「Archive is not a ZIP archive」。curl 的 --data-binary 不碰字节。
#
# --ssl-no-revoke：部分网络下 schannel 取不到吊销列表，会直接拒绝连接。
$localSize = (Get-Item $Apk).Length
$uploadBase = "https://uploads.github.com/repos/$Repo/releases/$($release.id)/assets"
$resultFile = Join-Path $env:TEMP "hs-release-upload.json"
Remove-Item $resultFile -Force -ErrorAction SilentlyContinue

Write-Output "上传中：$apkName（$localSize 字节，curl 二进制模式）"
& curl.exe -sS --ssl-no-revoke -X POST --max-time 900 `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/vnd.android.package-archive" `
  -H "User-Agent: HomeworkShower-Release" `
  --data-binary "@$Apk" `
  "$uploadBase`?name=$([uri]::EscapeDataString($apkName))" `
  -o $resultFile
if (-not (Test-Path $resultFile)) { throw "上传没有返回结果（curl 失败）" }

$asset = Get-Content $resultFile -Raw | ConvertFrom-Json
if (-not $asset.name) { throw "上传失败：$(Get-Content $resultFile -Raw)" }
Write-Output "资产已上传：$($asset.name)  $($asset.size) 字节"

if ($asset.size -ne $localSize) {
  throw "上传后大小不一致：本地 $localSize / 线上 $($asset.size) —— 资产可能在传输中被改写，请重试"
}
Write-Output "  ✅ 大小一致（本地与服务端都是 $localSize 字节）"

Write-Output "下载地址：$($asset.browser_download_url)"
Write-Output "页面：$($release.html_url)"
Write-Output ""
Write-Output "提示：这条直连链路可能中途断流，用户下到半截的包会装不上（报 Archive is not a ZIP archive）。"
Write-Output "     可让用户用工具核对：node tools/verify-release-apk.mjs <下载的apk> $Tag"
