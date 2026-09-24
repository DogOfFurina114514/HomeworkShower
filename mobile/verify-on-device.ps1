# 真机验证脚本：装 APK → 启动 → 截图 → 抓日志
#
# 用法：
#   pwsh -NoProfile -File mobile/verify-on-device.ps1 -Apk <apk路径> [-Out <截图目录>]
#
# 做的事：
#   1. 确认有设备连接（没有就明确报错，不做任何事）；
#   2. adb install -r 覆盖安装；
#   3. 清掉旧的更新记录（可选，-Fresh 时执行）后启动 App；
#   4. 等 6 秒截图（开屏检查/弹窗应该已经出现）；
#   5. 打印最近的崩溃与更新相关日志。

param(
  [Parameter(Mandatory = $true)][string]$Apk,
  [string]$Out = "F:\DeepSeekHarness\Workspace\_device_shots",
  [string]$Package = "com.dogoffurina.homeworkshower",
  [switch]$Fresh
)

$ErrorActionPreference = "Stop"
$adb = "D:\Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adb)) { throw "找不到 adb：$adb" }
if (-not (Test-Path $Apk)) { throw "找不到 APK：$Apk" }

$devices = & $adb devices | Select-String -Pattern "\tdevice$"
if (-not $devices) {
  Write-Output "没有已连接的设备（adb devices 为空）。请用 USB 连上手机并开启 USB 调试后重试。"
  Write-Output "当前设备列表："
  & $adb devices -l
  exit 2
}
Write-Output "已连接设备：$($devices -join ', ')"

New-Item -ItemType Directory -Path $Out -Force | Out-Null

Write-Output "=== 安装 $Apk ==="
& $adb install -r $Apk 2>&1 | Select-Object -Last 3

if ($Fresh) {
  Write-Output "=== 清除旧的更新记录（模拟首次安装）==="
  & $adb shell run-as $Package rm -f /data/data/$Package/shared_prefs/homework_shower_update.xml 2>&1 | Out-Null
  & $adb shell run-as $Package rm -rf /data/data/$Package/files/site 2>&1 | Out-Null
}

Write-Output "=== 启动 App ==="
& $adb shell am force-stop $Package | Out-Null
Start-Sleep -Milliseconds 600
& $adb logcat -c
& $adb shell monkey -p $Package -c android.intent.category.LAUNCHER 1 2>&1 | Select-Object -Last 2

Write-Output "=== 等待 8 秒（开屏检查 + 可能的弹窗）==="
Start-Sleep -Seconds 8
& $adb shell screencap -p /sdcard/hs_1.png | Out-Null
& $adb pull /sdcard/hs_1.png "$Out\step1_launch.png" 2>&1 | Select-Object -Last 1

Write-Output "=== 再等 6 秒（热更新/下载进度）==="
Start-Sleep -Seconds 6
& $adb shell screencap -p /sdcard/hs_2.png | Out-Null
& $adb pull /sdcard/hs_2.png "$Out\step2_after.png" 2>&1 | Select-Object -Last 1

Write-Output "=== App 相关日志 ==="
& $adb logcat -d -t 200 2>&1 | Select-String -Pattern "homeworkshower|AndroidRuntime|WebUpdater|UpdateChecker|ApkUpdater|crash" | Select-Object -Last 40

Write-Output ""
Write-Output "截图已保存到：$Out"
Write-Output "如需看当前界面层级：adb shell uiautomator dump /sdcard/ui.xml; adb pull /sdcard/ui.xml"
