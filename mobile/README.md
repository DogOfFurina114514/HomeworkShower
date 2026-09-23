# 手机端（Android WebView 壳）

就是把**与网页端完全相同的那一份页面**内置进 App，用 WebView 打开，不重写任何界面。

## 目录

```
mobile/
├─ sync-assets.ps1          # 把 ../docs 原样同步到 app/src/main/assets/site
└─ app/src/main/
   ├─ assets/site/          # 内置的网页（由脚本同步，勿手改）
   ├─ java/.../MainActivity.kt
   ├─ res/                  # 主题、图标、网络安全配置
   └─ AndroidManifest.xml
```

## 构建（需要 Android Studio 或 Android SDK）

1. 用 **Android Studio** 打开 `mobile/` 目录（它会自动补 Gradle Wrapper 与 SDK）；
2. 命令行构建：`cd mobile && gradle assembleDebug`（首次会下载 Gradle 与依赖）；
3. 产物：`app/build/outputs/apk/debug/app-debug.apk`。

> 本仓库不含 Gradle Wrapper 二进制，用 Android Studio 打开时会自动生成；
> 若只用命令行，先执行一次 `gradle wrapper`。

## 页面更新后要重新同步

改了 `docs/` 之后：

```powershell
pwsh -File mobile/sync-assets.ps1
```

然后再构建一次 APK 即可。

## 壳里做的处理

**必需的一步**：页面通过 `WebViewAssetLoader` 从
`https://appassets.androidplatform.net/assets/site/index.html` 加载，而不是 `file://`。
因为 `file://` 下 localStorage 与跨域请求会被限制，Supabase 的登录态根本存不住。

**屏蔽 WebView 自带组件**（你要求的部分）：

| 项目 | 处理 |
|---|---|
| 长按图片/链接弹出的系统菜单 | `setOnLongClickListener { true }` + 清空 context menu 监听 |
| 长按震动反馈 | `isHapticFeedbackEnabled = false` |
| 文字选择手柄 | 关闭长按 + CSS `-webkit-touch-callout: none` |
| 图片拖拽 | CSS `-webkit-user-drag: none` |
| 双指缩放与缩放按钮 | `setSupportZoom(false)`、`builtInZoomControls = false` |
| 滚到尽头的边缘光效 | `overScrollMode = OVER_SCROLL_NEVER` |
| 混合内容 | `MIXED_CONTENT_NEVER_ALLOW`，只允许 HTTPS |
| 本地文件访问 | 全部关闭（页面只从内置 assets 走虚拟域名） |

**保留的功能**：返回键优先回退网页历史；富文本「插入图片」会唤起系统文件选择器；
站外链接跳系统浏览器；深色模式跟随系统（`Theme.Material3.DayNight.NoActionBar`）。

## 注意

- 邮件验证链接仍然指向网页端 `https://dogoffurina114514.github.io/HomeworkShower/auth.html`，
  在浏览器里点完后，回到 App 用邮箱密码登录即可；
- 手机端登录态与浏览器相互独立（不同存储空间）。


---

## 应用内更新（规格，实现中）

版本号规则：`年份.大功能.小补丁`，打包号 = `年份×10000 + 大功能×100 + 小补丁`
（例：`26.0.0` → `260000`）。最前面一位每年变，第二位为大功能，第三位为小补丁。

### 检查顺序

1. **两个更新同时检查**（热更新与本体更新并发）；
2. 两者都优先请求 `https://dogoffurina114514.github.io/HomeworkShower/version.json`；
3. 拉不到（离线/被墙）→ **回退 Supabase**（`app_web_release` / `app_web_manifest` / `app_releases`）；
4. **两处都失败 → 开屏直接显示「网络错误」**，不进主界面（连 Supabase 都不通的话，进去也看不到作业）；
5. 无更新则**静默**。

### 热更新（网页，增量）

- 用 `manifest.json`（GitHub）或 `app_web_manifest`（Supabase）比对本地各文件哈希，**只下载变化的文件**；
- 每个文件依次尝试：`gh.dpik.top` → `gh.llkk.cc` → 主站；
- **原子性**：先下到临时目录 → 全部成功并校验后一次性替换 → **最后才写版本号**。
  任何一步失败都保持旧版不动，绝不出现"更了一半却显示最新"。

### 本体更新（下载安装包）

- 比较 `apkVersionCode`（来自 `version.json` 或 `app_releases`）；
- APK 地址 = `apkUrlTemplate` 替换版本号，镜像前缀依次尝试：`gh.dpik.top/` → `gh.llkk.cc/` → 直连（空串）；
- 下载完成后调用系统安装器。

### 弹窗（原生 Android，M3 风格）

- **本体更新弹窗在上，热更新弹窗在下**；
- 说明文字取自 `apkNotes`；
- 可选更新（`apkMandatory = false`）：按钮为「立即更新」+「稍后」；
- **强制更新（`apkMandatory = true`）：按钮为「立即更新」+「退出」**
  （没有"稍后"，用户只能更新或退出 App）。

### 发布约定

- **只有框架程序（APK）更新时才发 Release**，文件名 `HomeworkShower_<版本>.apk`，tag 用版本号（如 `26.0.0`）；
- 网页更新**只**需要：改 `docs/` → `node tools/web-manifest.mjs`（写 `docs/manifest.json` 并同步 Supabase）→ 改 `docs/version.json` 的 `webVersion/webVersionCode`；
- Supabase 侧每 10 分钟自动跟随 GitHub，忘记手动同步也不会落后。

### 强制更新的"累积性"（重要）

判定强制与否**不能只看最新一版**，要看**本地版本之后有没有出现过强制版本**：

- `version.json` 里的 `apkMandatorySince` = **历史最高强制版本号**（`0` 表示从未有过强制版本）；
- 判定规则：`本地 version_code < apkMandatorySince` → **强制更新**（弹窗左键为「退出」）；
- 反例说明：用户处于 `1` 版本 → 发布了必须更新的 `2` 版本 → 现在最新是 `3` 版本（本身是可选更新）；
  此时用户的 `1 < apkMandatorySince(=2 的版本号)` → **仍然强制**更新到最新（`3`），不能跳过 `2`；
- 用 Supabase 校验同一规则时：查 `app_releases?mandatory=eq.true&order=version_code.desc&limit=1`，
  取到的 `version_code` 即 `apkMandatorySince`。
