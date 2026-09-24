package com.dogoffurina.homeworkshower

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.webkit.WebViewAssetLoader
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.Executors

/**
 * 极简 WebView 壳 + 应用内更新。
 *
 * 启动顺序：
 *   开屏「正在检查更新」→ 读 version.json（GitHub Pages，失败回退 Supabase）
 *     两个来源都连不上 → 开屏直接显示网络错误，不进主界面（进去了也看不到作业）
 *   有本体更新 → 先弹本体更新弹窗（可选的「稍后」、强制的「退出」）
 *   有热更新   → 再弹热更新弹窗（同样规则）
 *   都没有     → 进入主界面
 *
 * 网页资源从内部存储加载（filesDir/site），WebViewAssetLoader 负责把
 * https://appassets.androidplatform.net/site/... 映射过去；这样热更新换文件后
 * 不需要重装 APK。没铺好基线时回退到 APK 内置的 assets/site。
 *
 * 不继承 AppCompatActivity、不用 Material 主题（部分 ROM 上会闪退），只用平台 Activity。
 */
class MainActivity : Activity() {

    private var webView: WebView? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()

    /** 主界面容器：检查通过后才把 WebView 放进来 */
    private lateinit var root: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 上次崩溃的记录优先显示 —— 崩在 Activity 创建之前的那种，只能靠这个看到原因
        val previous = CrashApplication.readCrash(this)
        if (previous != null) {
            showSavedCrash(previous)
            return
        }

        try {
            WebView.setWebContentsDebuggingEnabled(false)
            root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            setContentView(root)
            showSplash("正在检查更新…")
            startUpdateCheck()
        } catch (error: Throwable) {
            showCrash(error)
        }
    }

    // ------------------------------------------------------------------ 开屏

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    /** 开屏：应用名 + 状态行（+ 可选的按钮） */
    private fun showSplash(message: String, detail: String? = null, buttonText: String? = null, onClick: (() -> Unit)? = null) {
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(32), dp(32), dp(32), dp(32))
            setBackgroundColor(Color.parseColor("#F5FAFC"))
        }
        column.addView(TextView(this).apply {
            text = "作业"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
            setTextColor(Color.parseColor("#006877"))
            typeface = Typeface.DEFAULT_BOLD
        })
        column.addView(TextView(this).apply {
            text = message
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setTextColor(Color.parseColor("#3F484A"))
            gravity = Gravity.CENTER
            setPadding(0, dp(14), 0, 0)
        })
        if (detail != null) {
            column.addView(TextView(this).apply {
                text = detail
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                setTextColor(Color.parseColor("#6F797B"))
                gravity = Gravity.CENTER
                setPadding(0, dp(8), 0, 0)
            })
        }
        if (buttonText != null && onClick != null) {
            column.addView(Button(this).apply {
                text = buttonText
                isAllCaps = false
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                setTextColor(Color.WHITE)
                background = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = dp(20).toFloat()
                    setColor(Color.parseColor("#006877"))
                }
                val params = LinearLayout.LayoutParams(dp(160), dp(44))
                params.topMargin = dp(20)
                layoutParams = params
                setOnClickListener { onClick() }
            })
        }

        root.removeAllViews()
        root.addView(
            column,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
    }

    /** 检查更新：拿版本信息 → 本体更新 → 热更新 → 进主界面 */
    private fun startUpdateCheck() {
        worker.execute {
            val info = UpdateChecker.loadVersionInfo()
            if (info == null) {
                main.post {
                    showSplash(
                        "网络连接失败",
                        "没能连上版本服务器，请检查网络后重试。",
                        "重试"
                    ) { startUpdateCheck() }
                }
                return@execute
            }

            // 热更新的基线：第一次启动把内置网页铺到内部存储
            // （this 在 Runnable 里指 Runnable，Context 必须用 this@MainActivity）
            val localAppCode = UpdateChecker.localVersionCode(this@MainActivity)
            WebUpdater.ensureBaseline(this@MainActivity, localAppCode)

            main.post { checkAppUpdate(info, localAppCode) }
        }
    }

    // ------------------------------------------------------------------ 本体更新

    private fun checkAppUpdate(info: UpdateChecker.VersionInfo, localAppCode: Int) {
        if (!UpdateChecker.hasAppUpdate(info, localAppCode)) {
            checkWebUpdate(info)
            return
        }
        // 累积强制规则：本地低于历史最高强制版本 → 强制更新到最新
        val mandatory = UpdateChecker.isMandatory(info, localAppCode)
        val notes = if (info.apkNotes.isBlank()) "" else "\n\n更新内容：${info.apkNotes}"
        val message = "当前版本 ${UpdateChecker.localVersionName(this)}（${localAppCode}）\n" +
            "最新版本 ${info.apkVersion}（${info.apkVersionCode}）" + notes +
            if (mandatory) "\n\n这个版本必须更新后才能继续使用。" else ""

        UpdateChecker.showDialog(
            activity = this,
            title = if (mandatory) "需要更新应用" else "发现新版本",
            message = message,
            primaryText = "立即更新",
            // 强制更新时不给"稍后"，只给"退出"
            secondaryText = if (mandatory) "退出" else "稍后",
            onPrimary = { downloadAppUpdate(info) },
            onSecondary = {
                if (mandatory) {
                    finishAffinity()
                } else {
                    checkWebUpdate(info)
                }
            }
        )
    }

    private fun downloadAppUpdate(info: UpdateChecker.VersionInfo) {
        val progress = showProgressDialog("正在下载安装包", "0%")
        worker.execute {
            // 注意 this 在 Runnable 里指的是 Runnable，必须显式写 this@MainActivity
            val result = ApkUpdater.download(
                context = this@MainActivity,
                info = info,
                onProgress = { p ->
                    val text = if (p.percent >= 0) "${p.percent}%" else "${p.doneBytes / 1024 / 1024} MB"
                    main.post { progress.update(text) }
                }
            )
            main.post {
                progress.dismiss()
                val file = result.file
                if (file == null) {
                    UpdateChecker.showDialog(
                        activity = this,
                        title = "下载失败",
                        message = result.message + "\n\n可以稍后再试，或到 GitHub Releases 手动下载。",
                        primaryText = "重试",
                        secondaryText = "稍后",
                        onPrimary = { downloadAppUpdate(info) },
                        onSecondary = { checkWebUpdate(info) }
                    )
                    return@post
                }
                try {
                    ApkUpdater.install(this, file)
                } catch (error: Throwable) {
                    UpdateChecker.showDialog(
                        activity = this,
                        title = "无法拉起安装器",
                        message = "安装包已下载到：\n${file.absolutePath}\n\n请手动打开安装；若系统提示，请允许本应用安装未知应用。",
                        primaryText = "知道了",
                        secondaryText = null,
                        onPrimary = { checkWebUpdate(info) },
                        onSecondary = null
                    )
                }
            }
        }
    }

    // ------------------------------------------------------------------ 热更新

    private fun checkWebUpdate(info: UpdateChecker.VersionInfo) {
        val localWebCode = UpdateChecker.localWebVersionCode(this)
        if (!UpdateChecker.hasWebUpdate(info, localWebCode)) {
            enterApp()
            return
        }

        val notes = "当前网页版本 $localWebCode → ${info.webVersion}（${info.webVersionCode}）"
        UpdateChecker.showDialog(
            activity = this,
            title = "有网页更新",
            message = "$notes\n\n只下载变化的文件，完成后会自动刷新界面。",
            primaryText = "立即更新",
            secondaryText = "稍后",
            onPrimary = { runWebUpdate(info) },
            onSecondary = { enterApp() }
        )
    }

    private fun runWebUpdate(info: UpdateChecker.VersionInfo) {
        val progress = showProgressDialog("正在更新网页", "准备中…")
        worker.execute {
            val manifest = WebUpdater.fetchManifest(info.manifestUrl)
            val result = WebUpdater.update(
                context = this@MainActivity,
                targetManifest = manifest,
                targetWebVersionCode = info.webVersionCode,
                sources = info.webSources.ifEmpty { listOf("https://gh.dpik.top/", "https://gh.llkk.cc/", "") },
                onProgress = { p ->
                    val percent = if (p.totalBytes > 0) (p.doneBytes * 100 / p.totalBytes).toInt() else -1
                    val text = if (percent >= 0) "$percent%（${p.index}/${p.total} 个文件）" else "${p.index}/${p.total} 个文件"
                    main.post { progress.update(text) }
                }
            )
            main.post {
                progress.dismiss()
                if (result.applied) enterApp() else {
                    UpdateChecker.showDialog(
                        activity = this,
                        title = "网页更新失败",
                        message = result.message + "\n\n当前的网页版本没有被改动，可以先用着，稍后再试。",
                        primaryText = "重试",
                        secondaryText = "先进入",
                        onPrimary = { runWebUpdate(info) },
                        onSecondary = { enterApp() }
                    )
                }
            }
        }
    }

    // ------------------------------------------------------------------ 进度弹窗

    private class ProgressDialog {
        var dialog: android.app.Dialog? = null
        var textView: TextView? = null
        fun update(text: String) {
            textView?.text = text
        }
        fun dismiss() {
            try {
                dialog?.dismiss()
            } catch (ignored: Throwable) {
                /* 忽略 */
            }
        }
    }

    private fun showProgressDialog(title: String, initial: String): ProgressDialog {
        val holder = ProgressDialog()
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(22), dp(24), dp(22))
            background = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(28).toFloat()
                setColor(Color.parseColor("#E3E9EB"))
            }
        }
        column.addView(TextView(this).apply {
            text = title
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setTextColor(Color.parseColor("#171D1E"))
        })
        val status = TextView(this).apply {
            text = initial
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setTextColor(Color.parseColor("#3F484A"))
            setPadding(0, dp(10), 0, 0)
        }
        column.addView(status)
        holder.textView = status

        val dialog = android.app.Dialog(this).apply {
            requestWindowFeature(android.view.Window.FEATURE_NO_TITLE)
            setContentView(ScrollView(this@MainActivity).apply {
                setBackgroundColor(Color.parseColor("#80101818"))
                addView(
                    LinearLayout(this@MainActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        gravity = Gravity.CENTER
                        setPadding(dp(20), dp(20), dp(20), dp(20))
                        addView(column, LinearLayout.LayoutParams(dp(320), ViewGroup.LayoutParams.WRAP_CONTENT))
                    },
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            })
            setCancelable(false)
            window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            window?.setBackgroundDrawableResource(android.R.color.transparent)
        }
        holder.dialog = dialog
        dialog.show()
        return holder
    }

    // ------------------------------------------------------------------ 主界面

    private fun enterApp() {
        try {
            root.removeAllViews()
            root.addView(
                buildWebView(),
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            )
        } catch (error: Throwable) {
            showCrash(error)
        }
    }

    private fun buildWebView(): View {
        val view = WebView(this)
        webView = view

        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
        }

        view.overScrollMode = View.OVER_SCROLL_NEVER
        view.isLongClickable = false
        view.isHapticFeedbackEnabled = false
        // 吞掉长按，避免弹出系统的图片/链接菜单
        view.setOnLongClickListener { true }
        view.setOnCreateContextMenuListener { _, _, _ -> }

        view.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                return try {
                    @Suppress("DEPRECATION")
                    startActivityForResult(params!!.createIntent(), REQUEST_FILE)
                    true
                } catch (error: Throwable) {
                    filePathCallback = null
                    false
                }
            }
        }

        val loader = buildAssetLoader()

        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                webView: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                return try {
                    loader.shouldInterceptRequest(request!!.url)
                } catch (error: Throwable) {
                    null
                }
            }

            override fun shouldOverrideUrlLoading(
                webView: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val url = request?.url ?: return false
                return if (url.host == "appassets.androidplatform.net") {
                    false
                } else {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, url))
                    } catch (error: Throwable) {
                        // 没有浏览器也不影响
                    }
                    true
                }
            }
        }

        view.loadUrl("https://appassets.androidplatform.net/site/index.html")
        return view
    }

    /**
     * 资源加载器：
     *   /site/...  → 内部存储里热更新后的网页（filesDir/site）
     *   /assets/...→ APK 内置资源（基线没铺好时的兜底）
     */
    private fun buildAssetLoader(): WebViewAssetLoader {
        val site = File(filesDir, "site")
        return WebViewAssetLoader.Builder()
            .addPathHandler("/site/", LocalSiteHandler(site))
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    /** 把 /site/<相对路径> 映射到内部存储目录；文件不存在时返回 null 交给 WebView（404） */
    private class LocalSiteHandler(private val base: File) : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse? {
            return try {
                val relative = path.trimStart('/')
                if (relative.isEmpty()) return null
                val file = File(base, relative)
                // 防目录穿越
                if (!file.canonicalPath.startsWith(base.canonicalPath)) return null
                if (!file.isFile) return null
                WebResourceResponse(mimeOf(relative), null, FileInputStream(file))
            } catch (error: Throwable) {
                null
            }
        }

        private fun mimeOf(path: String): String {
            return when (path.substringAfterLast('.', "").lowercase()) {
                "html" -> "text/html"
                "css" -> "text/css"
                "js", "mjs" -> "text/javascript"
                "json" -> "application/json"
                "svg" -> "image/svg+xml"
                "png" -> "image/png"
                "jpg", "jpeg" -> "image/jpeg"
                "webp" -> "image/webp"
                "ico" -> "image/x-icon"
                "woff2" -> "font/woff2"
                "woff" -> "font/woff"
                "txt" -> "text/plain"
                else -> "application/octet-stream"
            }
        }
    }

    // ------------------------------------------------------------------ 生命周期

    @Deprecated("平台 Activity 的旧接口，这里够用且兼容性最好")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQUEST_FILE) {
            filePathCallback?.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            )
            filePathCallback = null
            return
        }
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
    }

    /** 显示上一次的崩溃记录，并给一个清除后重试的按钮 */
    private fun showSavedCrash(report: String) {
        val reportView = TextView(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTextColor(Color.parseColor("#410002"))
            setBackgroundColor(Color.parseColor("#FFDAD6"))
            setPadding(32, 48, 32, 48)
            setText("上次启动崩溃了：\n\n$report")
        }
        val retry = Button(this).apply {
            text = "清除记录并重试"
            setOnClickListener {
                CrashApplication.clearCrash(this@MainActivity)
                recreate()
            }
        }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            addView(reportView, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            addView(retry)
        }
        setContentView(ScrollView(this).apply { addView(column) })
    }

    /** 出问题时把原因画出来，而不是直接闪退 */
    private fun showCrash(error: Throwable) {
        val reportView = TextView(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTextColor(Color.parseColor("#410002"))
            setBackgroundColor(Color.parseColor("#FFDAD6"))
            setPadding(32, 48, 32, 48)
            setText("启动失败：\n\n" + android.util.Log.getStackTraceString(error))
        }
        val retry = Button(this).apply {
            text = "重试"
            setOnClickListener { recreate() }
        }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            addView(reportView, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            addView(retry)
        }
        setContentView(ScrollView(this).apply { addView(column) })
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val view = webView
        if (view != null && view.canGoBack()) view.goBack() else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    override fun onPause() {
        super.onPause()
        webView?.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
    }

    override fun onDestroy() {
        webView?.destroy()
        worker.shutdownNow()
        super.onDestroy()
    }

    private companion object {
        const val REQUEST_FILE = 1001
    }
}
