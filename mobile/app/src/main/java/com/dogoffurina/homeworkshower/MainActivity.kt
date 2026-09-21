package com.dogoffurina.homeworkshower

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
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

/**
 * 极简 WebView 壳：
 * - 不继承 AppCompatActivity、不用 Material 主题（部分 ROM 上会闪退），只用平台 Activity；
 * - 启动过程包在 try/catch 里，出问题就把堆栈画在屏幕上，方便截图反馈；
 * - 屏蔽长按菜单、手势缩放、边缘光效等 WebView 自带组件。
 */
class MainActivity : Activity() {

    private var webView: WebView? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            WebView.setWebContentsDebuggingEnabled(false)
            setContentView(buildWebView())
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

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

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

        view.loadUrl("https://appassets.androidplatform.net/assets/site/index.html")
        return view
    }

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

    /** 出问题时把原因画出来，而不是直接闪退 */
    private fun showCrash(error: Throwable) {
        val text = TextView(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setTextColor(Color.parseColor("#410002"))
            setBackgroundColor(Color.parseColor("#FFDAD6"))
            setPadding(32, 48, 32, 48)
            text = "启动失败：\n\n" + android.util.Log.getStackTraceString(error)
        }
        val retry = Button(this).apply {
            text = "重试"
            setOnClickListener { recreate() }
        }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            addView(text, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
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
        super.onDestroy()
    }

    private companion object {
        const val REQUEST_FILE = 1001
    }
}
