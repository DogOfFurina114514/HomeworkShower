package com.dogoffurina.homeworkshower

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * 版本信息与更新检查。
 *
 * 检查顺序（两个更新共用同一份版本信息）：
 *   1. 先请求 GitHub Pages 上的 version.json（国内相对好访问）；
 *   2. 拉不到就回退 Supabase（app_web_release / app_web_manifest / app_releases）；
 *   3. 两处都失败 → 开屏直接提示网络错误，不进入主界面
 *      （连 Supabase 都不通的话，进去了也看不到作业）。
 *
 * 强制更新遵循"累积性"：本地 version_code < apkMandatorySince 即强制，
 * 不能跳过中间出现过的强制版本。
 */
object UpdateChecker {

    /** version.json 的内容（Supabase 回退时会拼出同样的结构） */
    data class VersionInfo(
        val webVersion: String,
        val webVersionCode: Int,
        val entry: String,
        val manifestUrl: String,
        val webSources: List<String>,
        val apkVersion: String,
        val apkVersionCode: Int,
        val apkMandatory: Boolean,
        /** 历史最高强制版本号；本地低于它就必须强制更新到最新 */
        val apkMandatorySince: Int,
        val apkNotes: String,
        val apkMirrors: List<String>,
        val apkUrlTemplate: String,
        /** 来源标记，仅用于日志排查 */
        val fromSupabase: Boolean
    )

    private const val PAGES_VERSION_URL =
        "https://dogoffurina114514.github.io/HomeworkShower/version.json"

    private const val SUPABASE_URL = "https://kmzcebxhewlihgqzfaqw.supabase.co"
    private const val SUPABASE_KEY = "sb_publishable_woB0DFosxaxHE1101sjfHA_Bt0SJMxG"

    /** 默认镜像（version.json 里会给，这里作为兜底） */
    private val DEFAULT_MIRRORS = listOf("https://gh.dpik.top/", "https://gh.llkk.cc/", "")

    /** 网络超时（毫秒）：开屏不能卡太久 */
    private const val TIMEOUT_MS = 8000

    /** 同步请求文本，失败返回 null */
    private fun httpGet(url: String): String? {
        return try {
            val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                requestMethod = "GET"
                setRequestProperty("Accept", "application/json")
                instanceFollowRedirects = true
            }
            connection.inputStream.bufferedReader().use { it.readText() }.also { connection.disconnect() }
        } catch (error: Throwable) {
            null
        }
    }

    /** Supabase 表的只读查询 */
    private fun supabaseGet(path: String): JSONArray? {
        val text = httpGet(
            "$SUPABASE_URL/rest/v1/$path&apikey=$SUPABASE_KEY&Authorization=Bearer%20$SUPABASE_KEY"
                .replace("&apikey", "?apikey")
        ) ?: return null
        return try {
            JSONArray(text)
        } catch (error: Throwable) {
            null
        }
    }

    /** ① Pages 上的 version.json */
    private fun fromPages(): VersionInfo? {
        val text = httpGet(PAGES_VERSION_URL) ?: return null
        return try {
            val json = JSONObject(text)
            VersionInfo(
                webVersion = json.optString("webVersion", "0.0.0"),
                webVersionCode = json.optInt("webVersionCode", 0),
                entry = json.optString("entry", "index.html"),
                manifestUrl = json.optString(
                    "manifestUrl",
                    "https://dogoffurina114514.github.io/HomeworkShower/manifest.json"
                ),
                webSources = json.optJSONArray("sources").toStringList(),
                apkVersion = json.optString("apkVersion", "0.0.0"),
                apkVersionCode = json.optInt("apkVersionCode", 0),
                apkMandatory = json.optBoolean("apkMandatory", false),
                apkMandatorySince = json.optInt("apkMandatorySince", 0),
                apkNotes = json.optString("apkNotes", ""),
                apkMirrors = json.optJSONArray("apkMirrors").toStringList().ifEmpty { DEFAULT_MIRRORS },
                apkUrlTemplate = json.optString("apkUrlTemplate", ""),
                fromSupabase = false
            )
        } catch (error: Throwable) {
            null
        }
    }

    /** ② Supabase 回退：把两张表拼成同样的结构 */
    private fun fromSupabase(): VersionInfo? {
        val releases = supabaseGet("app_web_release?select=version,version_code,entry&order=version_code.desc&limit=1")
        val apps = supabaseGet("app_releases?select=version,version_code,mandatory,notes,apk_url&order=version_code.desc&limit=1")
        val mandatory = supabaseGet("app_releases?select=version_code&mandatory=eq.true&order=version_code.desc&limit=1")
        val web = releases?.optJSONObject(0) ?: return null
        val app = apps?.optJSONObject(0)

        return VersionInfo(
            webVersion = web.optString("version", "0.0.0"),
            webVersionCode = web.optInt("version_code", 0),
            entry = web.optString("entry", "index.html"),
            manifestUrl = "",
            webSources = listOf(""),
            apkVersion = app?.optString("version", "0.0.0") ?: "0.0.0",
            apkVersionCode = app?.optInt("version_code", 0) ?: 0,
            apkMandatory = app?.optBoolean("mandatory", false) ?: false,
            apkMandatorySince = mandatory?.optJSONObject(0)?.optInt("version_code", 0) ?: 0,
            apkNotes = app?.optString("notes", "") ?: "",
            apkMirrors = DEFAULT_MIRRORS,
            apkUrlTemplate = "https://github.com/DogOfFurina114514/HomeworkShower/releases/download/{version}/HomeworkShower_{version}.apk",
            fromSupabase = true
        )
    }

    /** 依次尝试两个来源；都失败返回 null（调用方据此显示网络错误） */
    fun loadVersionInfo(): VersionInfo? = fromPages() ?: fromSupabase()

    /** 本地已安装的版本号 */
    fun localVersionCode(context: Context): Int {
        return try {
            context.packageManager.getPackageInfo(context.packageName, 0).let { info ->
                @Suppress("DEPRECATION")
                info.versionCode
            }
        } catch (error: Throwable) {
            0
        }
    }

    /** 本地热更新的网页版本号（存在 SharedPreferences） */
    fun localWebVersionCode(context: Context): Int =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_WEB_VERSION_CODE, 0)

    fun saveWebVersionCode(context: Context, value: Int) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putInt(KEY_WEB_VERSION_CODE, value).apply()
    }

    private const val PREFS = "homework_shower_update"
    private const val KEY_WEB_VERSION_CODE = "web_version_code"

    /** 是否强制更新：本地低于"历史最高强制版本"就强制（不能跳过中间的强制版本） */
    fun isMandatory(info: VersionInfo, localCode: Int): Boolean =
        localCode > 0 && localCode < info.apkMandatorySince

    /** 有本体更新吗 */
    fun hasAppUpdate(info: VersionInfo, localCode: Int): Boolean = info.apkVersionCode > localCode

    /** 有热更新吗 */
    fun hasWebUpdate(info: VersionInfo, localWebCode: Int): Boolean =
        info.webVersionCode > localWebCode || localWebCode == 0

    // ------------------------------------------------------------------ 弹窗

    private fun dp(context: Context, value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), context.resources.displayMetrics).toInt()

    private fun rounded(color: Int, radiusDp: Int): GradientDrawable =
        GradientDrawable().apply { cornerRadius = dp(currentContext!!, radiusDp).toFloat(); setColor(color) }

    private var currentContext: Context? = null

    /**
     * 原生 M3 风格弹窗（不依赖任何库，手绘：大圆角、胶囊按钮、主色）。
     * 返回关闭弹窗的方法。
     */
    fun showDialog(
        activity: Activity,
        title: String,
        message: String,
        primaryText: String,
        secondaryText: String?,
        onPrimary: () -> Unit,
        onSecondary: (() -> Unit)?
    ) {
        currentContext = activity
        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(activity, 24), dp(activity, 22), dp(activity, 24), dp(activity, 18))
            background = rounded(Color.parseColor("#E3E9EB"), 28)
        }

        root.addView(TextView(activity).apply {
            text = title
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 21f)
            setTextColor(Color.parseColor("#171D1E"))
            setPadding(0, 0, 0, dp(activity, 10))
        })

        root.addView(TextView(activity).apply {
            text = message
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setTextColor(Color.parseColor("#3F484A"))
            setLineSpacing(dp(activity, 4).toFloat(), 1f)
        })

        val buttons = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
            setPadding(0, dp(activity, 18), 0, 0)
        }

        val dialog = android.app.Dialog(activity).apply {
            requestWindowFeature(android.view.Window.FEATURE_NO_TITLE)
            setContentView(ScrollView(activity).apply {
                setBackgroundColor(Color.parseColor("#80101818"))
                addView(
                    LinearLayout(activity).apply {
                        orientation = LinearLayout.VERTICAL
                        gravity = Gravity.CENTER
                        setPadding(dp(activity, 20), dp(activity, 20), dp(activity, 20), dp(activity, 20))
                        addView(root, LinearLayout.LayoutParams(dp(activity, 320), ViewGroup.LayoutParams.WRAP_CONTENT))
                    },
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            })
            setCancelable(false)
            window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            window?.setBackgroundDrawableResource(android.R.color.transparent)
        }

        fun addButton(text: String, filled: Boolean, onClick: () -> Unit) {
            buttons.addView(Button(activity).apply {
                this.text = text
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                isAllCaps = false
                setTextColor(if (filled) Color.WHITE else Color.parseColor("#006877"))
                background = rounded(if (filled) Color.parseColor("#006877") else Color.TRANSPARENT, 20)
                val params = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    dp(activity, 42)
                )
                params.marginStart = dp(activity, 8)
                layoutParams = params
                setPadding(dp(activity, 20), 0, dp(activity, 20), 0)
                setOnClickListener { onClick() }
            })
        }

        if (secondaryText != null) {
            addButton(secondaryText, false) { dialog.dismiss(); onSecondary?.invoke() }
        }
        addButton(primaryText, true) { dialog.dismiss(); onPrimary() }

        root.addView(buttons)
        dialog.show()
    }

    private fun JSONArray?.toStringList(): List<String> {
        if (this == null) return emptyList()
        val list = mutableListOf<String>()
        for (index in 0 until length()) list.add(optString(index))
        return list
    }
}
