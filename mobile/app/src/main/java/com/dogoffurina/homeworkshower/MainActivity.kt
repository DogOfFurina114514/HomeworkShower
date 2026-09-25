package com.dogoffurina.homeworkshower

import android.app.Activity
import android.app.DownloadManager
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
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
 *   有本体更新 → 弹本体更新弹窗（可选的「稍后」、强制的「退出」）
 *   有热更新   → **不弹确认，直接开始下**，只显示进度条
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

    /** 当前显示的开屏页（用于就地更新进度，而不是重建整页） */
    private var currentSplashPage: View? = null

    private companion object {
        const val REQUEST_FILE = 1001

        /** 进度条与百分比文字的查找标记（就地更新用） */
        const val TAG_PROGRESS_BAR = "hs-progress-bar"
        const val TAG_PROGRESS_TEXT = "hs-progress-text"
    }

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
            showSplash(message = "正在检查更新…", loading = true)
            startUpdateCheck()
        } catch (error: Throwable) {
            showCrash(error)
        }
    }

    // ------------------------------------------------------------------ 开屏

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    /**
     * 开屏即界面：检查更新、更新本身都在这里显示，不再往上叠弹窗。
     *
     * 结构（M3 的骨架）：
     *   左上角标题「作业」+ 中间一块内容区（图标或环形进度 + 状态文字 + 说明）+ 底部操作按钮
     * 每次换状态都走 crossFade，避免"界面突然换掉"的突兀感。
     */
    private fun showSplash(
        message: String,
        detail: String? = null,
        buttonText: String? = null,
        onClick: (() -> Unit)? = null,
        actions: List<Triple<String, Boolean, () -> Unit>> = emptyList(),
        loading: Boolean = false,
        percent: Int = -1,
        /** 拿不到总大小时：进度条走不确定动画，文字显示已下载多少 MB（默认按 percent 推断） */
        percentUnknown: Boolean = percent < 0,
        downloadedBytes: Long = 0L,
        secondaryButtonText: String? = null,
        onSecondary: (() -> Unit)? = null
    ) {
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(28), 0, dp(28), dp(24))
        }

        // "只是在忙、没有具体进度"时，顶部放官方 Material 的 LoadingIndicator：
        // 它就是 M3 那个"转着转着换一个形状"的加载指示器，不用自己画。
        var wavyProgress: com.google.android.material.progressindicator.LinearProgressIndicator? = null
        if (percent < 0) {
            if (loading) {
                content.addView(
                    com.google.android.material.loadingindicator.LoadingIndicator(this).apply {
                        layoutParams = LinearLayout.LayoutParams(dp(56), dp(56))
                        indicatorSize = dp(38)
                        setIndicatorColor(Color.parseColor("#006877"))
                    }
                )
            } else {
                content.addView(TextView(this).apply {
                    text = if (buttonText != null) "⚠" else "•"
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
                    setTextColor(Color.parseColor("#006877"))
                    gravity = Gravity.CENTER
                })
            }
        }

        content.addView(TextView(this).apply {
            text = message
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            setTextColor(Color.parseColor("#171D1E"))
            gravity = Gravity.CENTER
            setPadding(0, if (percent < 0) dp(18) else 0, 0, 0)
        })

        // 进度条紧贴在百分比数字**上一行**：先条、后数字。
        // 之前进度条画在最顶上，中间隔着说明文字，百分比和条离得很远，看着对不上。
        if (percent >= 0) {
            // 用官方 Material 的 LinearProgressIndicator（M3 外形：圆角轨道 + 末端停止点）。
            //
            // 关于"波浪"：Material 1.13.0 的 View 版确实带了 waveAmplitude /
            // wavelengthDeterminate 属性，但实测画不出波浪 —— 振幅由 Drawable 的 level 决定
            // （DeterminateDrawable.getAmplitudeFractionFromLevel：只有 level 落在
            //  1000~9000 才给 1），而 View 层没有公开的入口去驱动它；
            // 真要有波浪得引 Compose（LinearWavyProgressIndicator），为了一个进度条不划算。
            // 结论：用官方直条，不自己画。
            wavyProgress = com.google.android.material.progressindicator.LinearProgressIndicator(this).apply {
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { topMargin = dp(18) }
                isIndeterminate = percentUnknown
                if (!percentUnknown) setProgressCompat(percent, true)
                trackCornerRadius = dp(6)
                trackThickness = dp(6)
                setIndicatorColor(Color.parseColor("#006877"))
                setTrackColor(Color.parseColor("#C9D4D8"))
                tag = TAG_PROGRESS_BAR
            }
            content.addView(wavyProgress)

            content.addView(TextView(this).apply {
                text = if (percentUnknown) "已下载 ${formatMb(downloadedBytes)}" else "$percent%"
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
                setTextColor(Color.parseColor("#006877"))
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                setPadding(0, dp(8), 0, 0)
                tag = TAG_PROGRESS_TEXT
            })
        }

        if (detail != null) {
            content.addView(TextView(this).apply {
                text = detail
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                setTextColor(Color.parseColor("#3F484A"))
                gravity = Gravity.CENTER
                setLineSpacing(dp(4).toFloat(), 1f)
                setPadding(0, dp(10), 0, 0)
            })
        }

        // 按钮区：单个按钮走 buttonText/onClick，多按钮走 actions
        val allActions = mutableListOf<Triple<String, Boolean, () -> Unit>>()
        if (buttonText != null && onClick != null) allActions.add(Triple(buttonText, true, onClick))
        if (secondaryButtonText != null && onSecondary != null) allActions.add(Triple(secondaryButtonText, false, onSecondary))
        allActions.addAll(actions)

        if (allActions.isNotEmpty()) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
                setPadding(0, dp(24), 0, 0)
            }
            for ((label, primary, action) in allActions) {
                val button = Button(this).apply {
                    text = label
                    isAllCaps = false
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                    setTextColor(if (primary) Color.WHITE else Color.parseColor("#006877"))
                    val params = LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        dp(44)
                    )
                    params.marginStart = dp(10)
                    params.marginEnd = dp(10)
                    layoutParams = params
                    setPadding(dp(22), 0, dp(22), 0)
                    setOnClickListener { action() }
                }
                applyM3ButtonFeedback(button, primary)
                row.addView(button)
            }
            content.addView(row)
        }

        // 整页：标题固定在左上角，其余内容在"标题以下的区域"里垂直居中
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            setPadding(dp(22), dp(20), dp(22), dp(16))
        }
        page.addView(TextView(this).apply {
            text = "作业"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
            setTextColor(Color.parseColor("#006877"))
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.START
        })

        // 注意：波浪进度条现在是在 content 里、紧贴百分比数字上方那一个。
        // 原来这里还有一处 page.addView(wavyProgress)（为了让进度条占满整宽），
        // 同一个 View 被加进两个父容器，直接抛
        // "The specified child already has a parent" —— 一进下载界面就崩。
        // 进度条改成"跟在百分比上面"之后，这一处必须删掉。

        // 上方一段弹性空白 + 内容 + 下方一段弹性空白：这样内容才是"剩余空间的中间"，
        // 只给内容加 weight=1 会让它贴着标题往下排（看着偏上）。
        page.addView(View(this), LinearLayout.LayoutParams(1, 0, 1f))
        page.addView(
            content,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        )
        page.addView(View(this), LinearLayout.LayoutParams(1, 0, 1f))

        crossFadeTo(page)
        currentSplashPage = page
    }

    /**
     * 只更新进度条与百分比文字，不重建界面。
     *
     * 之前是每个进度回调都调一次 showSplash()，等于每 64KB 把整页重建一次
     * （还带 crossFade 动画），所以界面一直闪、波浪动画也不断从头开始。
     */
    private fun updateSplashProgress(percent: Int, doneBytes: Long) {
        val page = currentSplashPage ?: return
        val unknown = percent < 0

        page.findViewWithTag<View>(TAG_PROGRESS_BAR)?.let { view ->
            (view as? com.google.android.material.progressindicator.LinearProgressIndicator)?.let { bar ->
                if (unknown) {
                    if (!bar.isIndeterminate) bar.isIndeterminate = true
                } else {
                    if (bar.isIndeterminate) bar.isIndeterminate = false
                    bar.setProgressCompat(percent, true)
                }
            }
        }

        page.findViewWithTag<View>(TAG_PROGRESS_TEXT)?.let { view ->
            (view as? TextView)?.text =
                if (unknown) "已下载 ${formatMb(doneBytes)}" else "$percent%"
        }
    }

    private fun formatMb(bytes: Long): String {
        val mb = bytes / 1024.0 / 1024.0
        return String.format(java.util.Locale.US, "%.1f MB", mb)
    }

    /**
     * M3 按钮的点击反馈：按下时从触点扩散的涟漪（状态层）+ 轻微下沉。
     * 用 RippleDrawable 而不是自定义动画 —— 它就是 Material 里的状态层实现，
     * 也是"点了没反应"这个问题的正解。注意必须设 clickable，否则涟漪不触发。
     */
    private fun applyM3ButtonFeedback(button: Button, primary: Boolean) {
        val radius = dp(20).toFloat()
        val base = android.graphics.drawable.GradientDrawable().apply {
            cornerRadius = radius
            setColor(if (primary) Color.parseColor("#006877") else Color.TRANSPARENT)
            if (!primary) {
                setStroke(dp(1), Color.parseColor("#BFC8CB"))
            }
        }
        // 末位 alpha 就是 M3 的状态层不透明度（按下 12%）
        val rippleColor = android.content.res.ColorStateList.valueOf(
            if (primary) Color.parseColor("#33FFFFFF") else Color.parseColor("#1F006877")
        )
        val mask = android.graphics.drawable.GradientDrawable().apply {
            cornerRadius = radius
            setColor(Color.WHITE)
        }
        button.background = android.graphics.drawable.RippleDrawable(rippleColor, base, mask)
        button.isClickable = true
        // 按下时轻微下沉，松开回弹
        button.setOnTouchListener { view, event ->
            when (event.actionMasked) {
                android.view.MotionEvent.ACTION_DOWN ->
                    view.animate().scaleX(0.97f).scaleY(0.97f).setDuration(90L).start()
                android.view.MotionEvent.ACTION_UP,
                android.view.MotionEvent.ACTION_CANCEL ->
                    view.animate().scaleX(1f).scaleY(1f).setDuration(140L).start()
            }
            false // 不消费事件，交给 Button 自己处理点击
        }
    }

    /**
     * 换界面时淡入淡出。
     *
     * 注意：**不能让"是否可见"依赖动画是否真的跑起来**。
     * 之前是 next.alpha = 0f 之后再 animate() 到 1；如果那一刻 Activity 还没真正显示，
     * 属性动画不会执行，页面就永远停在 alpha = 0 —— 布局树里有节点、屏幕上却一片白。
     * 现在先把新页面设为可见再加进去，只有淡出旧页面用动画。
     */
    private fun crossFadeTo(next: View) {
        val container = root
        val params = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        val previous = if (container.childCount > 0) container.getChildAt(0) else null

        next.alpha = 1f
        container.addView(next, params)

        if (previous != null) {
            previous.animate().alpha(0f).setDuration(160L).withEndAction {
                container.removeView(previous)
            }.start()
        }
    }

    // ------------------------------------------------------------------ 本体更新

    /**
     * 顺序**必须是先本体、后热更新**，不能反过来：
     *   1. 本体（APK）更新要用户确认、可能还要走系统安装器，必须先问；
     *   2. 热更新是自动的，一旦先跑，用户会在"刚打开就被换掉网页"之后
     *      才看到本体更新提示，观感很怪；
     *   3. 而且新版的网页资源可能依赖新版 APK 的能力，反过来装就会出问题。
     * 所以：有本体更新 → 只处理本体；用户选了"稍后"或不强制 → 再继续热更新。
     */
    private fun checkAppUpdate(info: UpdateChecker.VersionInfo, localAppCode: Int) {
        if (!UpdateChecker.hasAppUpdate(info, localAppCode)) {
            checkWebUpdate(info)
            return
        }
        // 累积强制规则：本地低于历史最高强制版本 → 强制更新到最新
        val mandatory = UpdateChecker.isMandatory(info, localAppCode)
        // 只用来决定按钮文案（下过一次就写「重新安装」），**不用来决定要不要放行**。
        val alreadyDownloaded = UpdateChecker.downloadedApkVersion(this) >= info.apkVersionCode

        val notes = if (info.apkNotes.isBlank()) "" else "\n\n更新内容：${info.apkNotes}"
        val detail = "当前版本 ${UpdateChecker.localVersionName(this)}（$localAppCode）\n" +
            "最新版本 ${info.apkVersion}（${info.apkVersionCode}）" + notes +
            if (mandatory) "\n\n这个版本必须更新后才能继续使用。" else ""

        showSplash(
            message = if (mandatory) "需要更新应用" else "发现新版本",
            detail = detail,
            buttonText = if (alreadyDownloaded) "重新安装" else "立即更新",
            onClick = { downloadAppUpdate(info, mandatory) },
            // 强制更新**任何情况下都不给「稍后」**：安装包下过没有、安装器有没有被取消，
            // 都不改变"这个版本必须装"这件事 —— 给一条"稍后"的路等于强制形同虚设。
            // 装不上只能重装，或者退出。
            secondaryButtonText = if (mandatory) "退出" else "稍后",
            onSecondary = {
                if (mandatory) finishAffinity() else checkWebUpdate(info)
            }
        )
    }

    private fun downloadAppUpdate(info: UpdateChecker.VersionInfo, mandatory: Boolean) {
        showSplash(
            message = "正在下载安装包",
            detail = "下载完成后会自动打开系统安装器。",
            loading = true,
            percent = 0
        )
        worker.execute {
            // 注意 this 在 Runnable 里指的是 Runnable，必须显式写 this@MainActivity
            val result = ApkUpdater.download(
                context = this@MainActivity,
                info = info,
                onProgress = { p ->
                    // 只更新进度条与文字，绝不重建界面
                    // （重建会让界面闪、波浪动画也不断从头开始）
                    val percent = p.percent
                    val done = p.doneBytes
                    main.post { updateSplashProgress(percent, done) }
                }
            )
            main.post {
                val file = result.file
                if (file == null) {
                    showSplash(
                        message = "下载失败",
                        detail = result.message + "\n\n可以重试，或到 GitHub Releases 手动下载。",
                        buttonText = "重试",
                        onClick = { downloadAppUpdate(info, mandatory) },
                        // 强制更新没有"先跳过"：重试或退出
                        secondaryButtonText = if (mandatory) "退出" else "先跳过",
                        onSecondary = {
                            if (mandatory) finishAffinity() else checkWebUpdate(info)
                        }
                    )
                    return@post
                }
                // 记下"这个版本已经下好了"，只用于把按钮文案换成「重新安装」
                UpdateChecker.saveDownloadedApkVersion(this, info.apkVersionCode)
                try {
                    ApkUpdater.install(this, file)
                    // 强制更新时这里也**不能**放行：安装器被取消是很常见的，
                    // 一旦给了"先跳过"，用户就绕过强制更新了。
                    showSplash(
                        message = "已交给系统安装器",
                        detail = if (mandatory) {
                            "按提示完成安装即可。\n\n如果安装器被取消，点「重新安装」再来一次 —— 这个版本必须装好才能继续使用。"
                        } else {
                            "按提示完成安装即可。\n\n没装成也没关系，点「先跳过」照样能进应用。"
                        },
                        buttonText = if (mandatory) "重新安装" else "先跳过",
                        onClick = {
                            if (mandatory) downloadAppUpdate(info, true) else checkWebUpdate(info)
                        },
                        secondaryButtonText = if (mandatory) "退出" else null,
                        onSecondary = if (mandatory) ({ finishAffinity() }) else null
                    )
                } catch (error: Throwable) {
                    showSplash(
                        message = "无法拉起安装器",
                        detail = "安装包已下载到：\n${file.absolutePath}\n\n请手动打开安装；若系统提示，请允许本应用安装未知应用。",
                        buttonText = if (mandatory) "重新安装" else "知道了",
                        onClick = {
                            if (mandatory) downloadAppUpdate(info, true) else checkWebUpdate(info)
                        },
                        secondaryButtonText = if (mandatory) "退出" else null,
                        onSecondary = if (mandatory) ({ finishAffinity() }) else null
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

        // 热更新不给确认步骤：开屏检查完就直接开始下，进度条照常显示。
        // 用户既不需要知道"有个网页更新"，也不该被问"要不要现在更新" ——
        // 网页资源本来就和 App 是一体的，落后一版就会出现"我这儿怎么还是旧样子"。
        runWebUpdate(info)
    }

    private fun runWebUpdate(info: UpdateChecker.VersionInfo) {
        val localWebCode = UpdateChecker.localWebVersionCode(this)
        showSplash(
            message = "正在更新网页",
            detail = "当前网页版本 $localWebCode → ${info.webVersion}（${info.webVersionCode}）\n" +
                "只下载有变化的文件，完成后自动进入。",
            loading = true,
            percent = 0
        )
        worker.execute {
            val manifest = WebUpdater.fetchManifest(info.manifestUrl)
            val result = WebUpdater.update(
                context = this@MainActivity,
                targetManifest = manifest,
                targetWebVersionCode = info.webVersionCode,
                sources = info.webSources.ifEmpty { listOf("https://gh.dpik.top/", "https://gh.llkk.cc/", "") },
                onProgress = { p ->
                    val percent = if (p.totalBytes > 0) (p.doneBytes * 100 / p.totalBytes).toInt() else -1
                    main.post {
                        showSplash(
                            message = "正在更新网页",
                            detail = "第 ${p.index}/${p.total} 个文件：${p.path}",
                            loading = true,
                            percent = percent
                        )
                    }
                }
            )
            main.post {
                if (result.applied) enterApp() else {
                    // 热更新是强制的（不给"稍后"），失败了也只给"重试/退出"：
                    // 放进去就等于让人用着落后一版的网页，
                    // 之后所有"我这儿怎么还是旧样子"的问题都会从这里来。
                    showSplash(
                        message = "网页更新失败",
                        detail = result.message + "\n\n当前的网页版本没有被改动，重试即可。",
                        buttonText = "重试",
                        onClick = { runWebUpdate(info) },
                        secondaryButtonText = "退出",
                        onSecondary = { finishAffinity() }
                    )
                }
            }
        }
    }


    /** 检查更新：拿版本信息 → 本体更新 → 热更新 → 进主界面 */
    private fun startUpdateCheck() {
        worker.execute {
            val info = UpdateChecker.loadVersionInfo()
            if (info == null) {
                main.post {
                    // 注意用命名参数：showSplash 的参数不止三个，
                    // 写尾随 lambda 会被当成最后一个参数（onSecondary），
                    // 结果 onClick 是 null，按钮整个不渲染 —— 之前"重试按钮不见了"就是这个。
                    showSplash(
                        message = "网络连接失败",
                        detail = "没能连上版本服务器，请检查网络后重试。",
                        buttonText = "重试",
                        onClick = { startUpdateCheck() },
                        secondaryButtonText = "退出",
                        onSecondary = { finishAffinity() }
                    )
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

    // ------------------------------------------------------------------ 主界面

    private fun enterApp() {
        try {
            // 已经在主界面了（比如补做热更新之后）：重新加载即可，别叠第二个 WebView
            val existing = webView
            if (existing != null) {
                existing.reload()
                return
            }
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

        // 页面里点「保存到手机」或下载链接时交给系统下载管理器。
        // WebView 自己不会下载文件，不接管的话点了没有任何反应。
        view.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            try {
                startSystemDownload(url, contentDisposition, mimeType)
            } catch (error: Throwable) {
                toast("无法调用系统下载管理器")
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

    // ------------------------------------------------------------------ 下载

    /**
     * 交给系统下载管理器（手机自带的那套：通知栏进度、下载完成可点开、进「下载」目录）。
     * 网页里点「保存到手机」或任何下载链接都会走到这里。
     */
    private fun startSystemDownload(url: String, contentDisposition: String?, mimeType: String?) {
        val fileName = guessFileName(url, contentDisposition, mimeType)
        val request = DownloadManager.Request(Uri.parse(url)).apply {
            setTitle(fileName)
            setDescription("正在保存到「下载」")
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            setAllowedOverMetered(true)
            setAllowedOverRoaming(true)
            if (mimeType.isNullOrBlank()) {
                setMimeType(guessMime(fileName))
            } else {
                setMimeType(mimeType)
            }
            try {
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
            } catch (error: Throwable) {
                // 少数机型/权限异常时退到应用专属目录，至少文件能落盘
                setDestinationInExternalFilesDir(this@MainActivity, Environment.DIRECTORY_DOWNLOADS, fileName)
            }
        }
        try {
            val manager = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
            manager.enqueue(request)
            toast("已交给系统下载管理器保存")
        } catch (error: Throwable) {
            // 完全没有下载管理器时，退回用浏览器打开
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (ignored: Throwable) {
                toast("这台设备没有可用的下载方式")
            }
        }
    }

    /** 从 Content-Disposition 或 URL 里猜文件名 */
    private fun guessFileName(url: String, contentDisposition: String?, mimeType: String?): String {
        val fromHeader = Regex("filename\\*?=(?:UTF-8''|\")?([^\";]+)", RegexOption.IGNORE_CASE)
            .find(contentDisposition ?: "")
            ?.groupValues
            ?.getOrNull(1)
            ?.trim()
            ?.trim('"')
        if (!fromHeader.isNullOrBlank()) {
            return try {
                java.net.URLDecoder.decode(fromHeader, "UTF-8")
            } catch (error: Throwable) {
                fromHeader
            }
        }

        val path = try {
            Uri.parse(url).lastPathSegment ?: ""
        } catch (error: Throwable) {
            ""
        }
        val name = path.substringAfterLast('/')
        if (name.isNotBlank() && name.contains('.')) return name

        val ext = when {
            mimeType == null -> "jpg"
            mimeType.contains("png") -> "png"
            mimeType.contains("webp") -> "webp"
            mimeType.contains("gif") -> "gif"
            mimeType.contains("jpeg") || mimeType.contains("jpg") -> "jpg"
            else -> "jpg"
        }
        val stamp = android.text.format.DateFormat.format("yyyyMMdd_HHmmss", System.currentTimeMillis())
        return "作业图片_$stamp.$ext"
    }

    private fun guessMime(fileName: String): String {
        return when (fileName.substringAfterLast('.', "").lowercase()) {
            "png" -> "image/png"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "jpg", "jpeg" -> "image/jpeg"
            "pdf" -> "application/pdf"
            "apk" -> "application/vnd.android.package-archive"
            else -> "application/octet-stream"
        }
    }

    /** 轻提示：页面里的 toast 走不通时（例如未进主界面）用系统 toast 兜底 */
    private fun toast(message: String) {
        try {
            android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_SHORT).show()
        } catch (ignored: Throwable) {
            /* 忽略 */
        }
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
                // 必须显式禁缓存：这些文件就是热更新的产物，每跑一次更新内容就变了，
                // 但 URL 没变。不设 Cache-Control 时 WebView 会按默认启发式缓存，
                // 结果"文件明明换新了，页面还在跑旧脚本"（改了半天用户那边没变化）。
                // 读的是本地文件，每次都真读一遍的代价可以忽略。
                val headers = mapOf(
                    "Cache-Control" to "no-store, no-cache, must-revalidate",
                    "Pragma" to "no-cache",
                )
                WebResourceResponse(mimeOf(relative), null, 200, "OK", headers, FileInputStream(file))
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
}
