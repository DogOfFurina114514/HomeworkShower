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

- 邮件验证链接仍然指向网页端 `https://dogofurina114514.github.io/HomeworkShower/auth.html`，
  在浏览器里点完后，回到 App 用邮箱密码登录即可；
- 手机端登录态与浏览器相互独立（不同存储空间）。
