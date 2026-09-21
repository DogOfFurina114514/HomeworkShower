package com.dogoffurina.homeworkshower

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

/**
 * 就是个壳：把与网页端完全相同的静态页面放进 assets/site，用 WebView 加载。
 *
 * 重点处理两件事：
 * 1. 用 WebViewAssetLoader 走 https://appassets.androidplatform.net/ 这个虚拟域名，
 *    而不是 file:// —— 否则 localStorage / fetch / Supabase 登录态都用不了。
 * 2. 屏蔽 WebView 自带的各种"系统组件"：长按图片菜单、长按链接菜单、
 *    文字选择手柄、滚动边缘光效、缩放控件、震动反馈等。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooser = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        filePathCallback?.onReceiveValue(
            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        )
        filePathCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 关掉 WebView 的调试开关（发布版不给外部调试）
        WebView.setWebContentsDebuggingEnabled(false)

        webView = WebView(this).apply {
            // ---- 页面能力 ----
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.mediaPlaybackRequiresUserGesture = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

            // 不开放本地文件访问（页面全部走 assets 虚拟域名）
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.allowFileAccessFromFileURLs = false
            settings.allowUniversalAccessFromFileURLs = false

            // ---- 屏蔽自带组件 ----
            settings.setSupportZoom(false)
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            settings.textZoom = 100
            overScrollMode = View.OVER_SCROLL_NEVER          // 去掉滚动到头的边缘光效
            isLongClickable = false                          // 关掉长按
            isHapticFeedbackEnabled = false                  // 关掉长按震动
            setOnLongClickListener { true }                  // 吞掉长按 → 不弹图片/链接菜单

            // 文字选择手柄也一并关掉（网页里需要选择时用输入框）
            isFocusable = true
            isFocusableInTouchMode = true
        }

        // 长按图片/链接时系统会走 context menu，这里也拦掉
        webView.setOnCreateContextMenuListener { _, _, _ -> /* 不弹任何菜单 */ }

        webView.webChromeClient = object : WebChromeClient() {
            // 富文本里"插入图片"要能选文件
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                return try {
                    fileChooser.launch(params.createIntent())
                    true
                } catch (error: Exception) {
                    filePathCallback = null
                    false
                }
            }
        }

        webView.webViewClient = object : WebViewClientCompat() {
            private val loader = WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this@MainActivity))
                .build()

            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url
                // 站内页面留在 WebView 里，其它链接交给系统浏览器
                return if (url.host == "appassets.androidplatform.net") {
                    false
                } else {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                    true
                }
            }
        }

        setContentView(webView)
        webView.loadUrl("https://appassets.androidplatform.net/assets/site/index.html")

        // 返回键优先回退网页历史
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
