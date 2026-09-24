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

# 3) 上传资产（multipart，避免 PowerShell 对二进制编码的坑）
Add-Type -AssemblyName System.Net.Http
$handler = New-Object System.Net.Http.HttpClientHandler
if ($Proxy) {
  $handler.Proxy = New-Object System.Net.WebProxy($Proxy, $true)
  $handler.UseProxy = $true
}
$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromMinutes(10)

$uploadUrl = ($release.upload_url -replace "\{.*\}$", "")
# 注意括号：-replace 的优先级会把后面的字符串拼接一起吞掉
$uploadUri = $uploadUrl + "?name=" + [uri]::EscapeDataString($apkName)
$content = New-Object System.Net.Http.MultipartFormDataContent
$bytes = [System.IO.File]::ReadAllBytes($Apk)
$fileContent = New-Object System.Net.Http.ByteArrayContent(,$bytes)
$fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("application/vnd.android.package-archive")
$content.Add($fileContent, "file", $apkName)

$request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, $uploadUri)
$request.Headers.Add("Authorization", "Bearer $token")
$request.Headers.Add("User-Agent", "HomeworkShower-Release")
$request.Headers.Add("Accept", "application/vnd.github+json")
$request.Content = $content

$response = $client.SendAsync($request).GetAwaiter().GetResult()
$body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
if (-not $response.IsSuccessStatusCode) {
  throw "上传失败：$($response.StatusCode) $body"
}
$asset = $body | ConvertFrom-Json
Write-Output "资产已上传：$($asset.name)  $([Math]::Round($asset.size / 1MB, 2)) MB"
Write-Output "下载地址：$($asset.browser_download_url)"
Write-Output "页面：$($release.html_url)"
