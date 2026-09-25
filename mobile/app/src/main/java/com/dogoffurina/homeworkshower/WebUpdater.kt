package com.dogoffurina.homeworkshower

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * 网页热更新（增量）。
 *
 * 站点资源跑在内部存储里，不再直接用 APK 内的 assets：
 *   filesDir/site/            当前生效的网页（WebView 从这里加载）
 *   filesDir/site.tmp/        下载中的临时目录
 * 第一次启动把 APK 内置的 assets/site 复制一份当基线，之后只下载变化的文件。
 *
 * 三条铁律（对应需求里的"绝不能更一半却显示最新"）：
 *   1. 所有文件先下到 site.tmp，任何一个文件三个源都拉不到就整体放弃，现场不动；
 *   2. 全部下载完并逐个校验 sha256，通过后才往正式目录搬；
 *   3. 版本号是最后一步写的 —— 中途任何失败都不会写版本号。
 */
object WebUpdater {

    /** 下载来源顺序：镜像优先（国内直连 GitHub 基本不通），最后回退主站 */
    private val DEFAULT_SOURCES = listOf(
        "https://gh.dpik.top/",
        "https://gh.llkk.cc/",
        "https://dogoffurina114514.github.io/HomeworkShower/"
    )

    private const val TIMEOUT_MS = 15000
    private const val PROGRESS_STEP = 64 * 1024

    /** 版本号和基线的记录，与 UpdateChecker 共用同一个 SharedPreferences */
    private const val PREFS = "homework_shower_update"
    private const val KEY_BASELINE = "web_baseline_code"

    /** 进度回调：第几个文件 / 共几个 / 当前文件名 / 已下载字节 / 总字节 */
    class Progress(
        val index: Int,
        val total: Int,
        val path: String,
        val doneBytes: Long,
        val totalBytes: Long
    )

    class Result(val updatedFiles: Int, val versionCode: Int, val applied: Boolean, val message: String)

    private fun dirs(context: Context) = File(context.filesDir, "site") to File(context.filesDir, "site.tmp")

    /** 当前生效的网页目录是否是内部存储那份（否则说明还是 APK 内置资源） */
    fun hasLocalSite(context: Context): Boolean {
        val (site, _) = dirs(context)
        return File(site, "index.html").isFile
    }

    /**
     * 首次运行：把 APK 内置的资产复制成基线，并记下基线版本号。
     * 这样即使网页目录被系统清掉，也能重新铺一份，而不是白屏。
     *
     * @param builtinAppCode APK 的 versionCode。**它只是"这份基线是从哪个包铺的"标记，
     *   不是网页版本号。** 两者混用会让热更新永久失效：内部记录被写成 260011，
     *   而线上网页版本才 20，`20 > 260011` 永远不成立，界面就一直是旧的那份。
     *   网页版本号只能从内置清单（assets/site/manifest.json）的 `versionCode` 读。
     */
    fun ensureBaseline(context: Context, builtinAppCode: Int) {
        val (site, temp) = dirs(context)
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val baseline = prefs.getInt(KEY_BASELINE, -1)
        val recorded = UpdateChecker.localWebVersionCode(context)
        val builtinWeb = readBuiltinManifest(context)?.optInt("versionCode", 0) ?: 0

        // 自愈：记录里的网页版本号如果高于磁盘上的实际内容（被下面那段"用内置资源盖回去"
        // 坑过的设备就是这个状态），以磁盘上的 manifest.versionCode 为准把记录拉回来，
        // 下一次检查更新就会重新把它升上去。
        val onDisk = readLocalManifest(context)?.optInt("versionCode", 0) ?: 0
        if (onDisk > 0 && onDisk < recorded) {
            UpdateChecker.saveWebVersionCode(context, onDisk)
        }
        val installed = UpdateChecker.localWebVersionCode(context)

        if (File(site, "index.html").isFile && baseline == builtinAppCode) {
            // 基线已经是这一版内置资源了，但记录里的网页版本号可能还没写过
            // （首次启动就属于这种：铺完基线若直接 return，热更新会看到本地版本 0，
            //   于是刚装好就弹一次"有网页更新 0 → 26.0.0"）。
            syncBuiltinVersion(context)
            return
        }

        // 磁盘上已经是比内置更新的一版网页：**不要**用内置资源把它盖回去。
        //
        // 踩过的坑：装新 APK 时，内置的网页版本可能比用户已经热更到的版本低
        // （26.0.10 内置网页 18，用户那边已经热更到 19）。原来这里会把 site 目录
        // 整个删掉重铺成内置的 18，可版本号还记着 19 —— 检查更新一算
        // "本地 19，线上 19，已是最新"，于是**永远不再更新**，
        // 用户就一直跑着旧页面，表现就是"打开最新版 App，检查完更新直接进去了"。
        if (File(site, "index.html").isFile && installed > 0 && builtinWeb > 0 && installed >= builtinWeb) {
            prefs.edit().putInt(KEY_BASELINE, builtinAppCode).apply()
            return
        }

        temp.deleteRecursively()
        temp.mkdirs()
        copyAssetTree(context, "site", temp)
        if (!File(temp, "index.html").isFile) {
            temp.deleteRecursively()
            return
        }

        site.deleteRecursively()
        if (!temp.renameTo(site)) {
            copyTree(temp, site)
            temp.deleteRecursively()
        }
        prefs.edit().putInt(KEY_BASELINE, builtinAppCode).apply()

        // 磁盘上现在确实是"内置那一版"了，网页版本号必须跟着回到**内置清单里的网页版本号**，
        // 否则检查更新会以为本地比磁盘实际的新，就会跳过该做的热更新。
        if (builtinWeb > 0) UpdateChecker.saveWebVersionCode(context, builtinWeb)

        // 基线自带内置清单，因此热更新只会下载"相对内置版本有变化"的文件
        syncBuiltinVersion(context)
    }

    /**
     * 把内置资源的网页版本号补进记录，只在没写过（或为 0）时写。
     * 这样"刚装好、网页与内置一致"时不会误报热更新；而用户已经热更新过（版本号比内置新）
     * 的情况不会被覆盖回退。
     *
     * 注意内置清单的字段名是 `versionCode`（tools/web-manifest.mjs 生成的），
     * 而 version.json 里叫 `webVersionCode` —— 两者不通用，另外它也**不是** APK 的 versionCode。
     */
    private fun syncBuiltinVersion(context: Context) {
        if (UpdateChecker.localWebVersionCode(context) > 0) return
        val builtin = readBuiltinManifest(context)?.optInt("versionCode", 0) ?: 0
        if (builtin > 0) UpdateChecker.saveWebVersionCode(context, builtin)
    }

    /** APK 内置的 manifest.json（随 APK 一起打包，记录基线版本号与文件哈希） */
    fun readBuiltinManifest(context: Context): JSONObject? {
        return try {
            val text = context.assets.open("site/manifest.json").bufferedReader().use { it.readText() }
            JSONObject(text)
        } catch (error: Throwable) {
            null
        }
    }

    /** 当前生效目录里的清单（如果存在） */
    private fun readLocalManifest(context: Context): JSONObject? {
        val (site, _) = dirs(context)
        val file = File(site, "manifest.json")
        if (!file.isFile) return null
        return try {
            JSONObject(file.readText())
        } catch (error: Throwable) {
            null
        }
    }

    /**
     * 执行热更新。同步阻塞，必须放在后台线程。
     *
     * @param targetManifest 目标清单（已下载并解析）；null 表示清单拉不到，直接失败
     * @param targetWebVersionCode 目标网页版本号（写进 SharedPreferences 的那个值）
     */
    fun update(
        context: Context,
        targetManifest: JSONObject?,
        targetWebVersionCode: Int,
        sources: List<String> = DEFAULT_SOURCES,
        onProgress: (Progress) -> Unit = {},
        isCancelled: () -> Boolean = { false }
    ): Result {
        if (!hasLocalSite(context)) {
            return Result(0, targetWebVersionCode, false, "网页基线还没准备好")
        }
        if (targetManifest == null) {
            return Result(0, targetWebVersionCode, false, "拿不到网页清单")
        }

        val (site, temp) = dirs(context)
        temp.deleteRecursively()
        temp.mkdirs()

        val files = targetManifest.optJSONArray("files")
        if (files == null || files.length() == 0) {
            temp.deleteRecursively()
            return Result(0, targetWebVersionCode, false, "清单里没有文件")
        }

        // 收集要下载的文件（本地哈希一致就跳过）
        val downloads = mutableListOf<Triple<String, String, Long>>() // 路径, 哈希, 大小
        var totalBytes = 0L
        val keep = mutableSetOf<String>()
        for (index in 0 until files.length()) {
            val item = files.optJSONObject(index) ?: continue
            val path = item.optString("path")
            val hash = item.optString("hash")
            if (path.isEmpty() || hash.isEmpty()) continue
            keep.add(path)
            val local = File(site, path)
            if (local.isFile && sha256(local) == hash) continue
            val bytes = item.optLong("bytes", 0L)
            downloads.add(Triple(path, hash, bytes))
            totalBytes += bytes
        }

        if (downloads.isEmpty()) {
            temp.deleteRecursively()
            // 文件都没变，只把版本号补上
            UpdateChecker.saveWebVersionCode(context, targetWebVersionCode)
            return Result(0, targetWebVersionCode, false, "已是最新")
        }

        var doneBytes = 0L
        var downloaded = 0
        for ((index, item) in downloads.withIndex()) {
            if (isCancelled()) {
                temp.deleteRecursively()
                return Result(0, targetWebVersionCode, false, "已取消")
            }
            val (path, hash, _) = item
            val target = File(temp, path)
            target.parentFile?.mkdirs()

            var ok = false
            for (source in sources) {
                if (isCancelled()) break
                val url = source + path
                val written = download(url, target, doneBytes, totalBytes, path, index, downloads.size, onProgress)
                if (written >= 0 && sha256(target) == hash) {
                    doneBytes += written
                    ok = true
                    break
                }
                target.delete()
            }
            if (!ok) {
                temp.deleteRecursively()
                return Result(0, targetWebVersionCode, false, "下载失败：$path")
            }
            downloaded++
        }

        // ② 全部下载并校验通过，才开始动正式目录
        for ((path, hash, _) in downloads) {
            val from = File(temp, path)
            if (!from.isFile || sha256(from) != hash) {
                temp.deleteRecursively()
                return Result(0, targetWebVersionCode, false, "校验失败：$path")
            }
            val to = File(site, path)
            to.parentFile?.mkdirs()
            if (to.exists()) to.delete()
            if (!from.renameTo(to)) {
                from.copyTo(to, overwrite = true)
                from.delete()
            }
        }

        // 清单里不再存在的旧文件（改名/删除的页面）一并清掉
        cleanStale(site, keep)

        // 清单本身也写进正式目录，下次启动就知道本地有哪些文件、什么哈希
        try {
            File(site, "manifest.json").writeText(targetManifest.toString())
        } catch (error: Throwable) {
            /* 写不进去不影响这次更新 */
        }

        temp.deleteRecursively()

        // ③ 最后一步才写版本号
        UpdateChecker.saveWebVersionCode(context, targetWebVersionCode)
        return Result(downloaded, targetWebVersionCode, true, "已更新 $downloaded 个文件")
    }

    /** 删掉清单里已经没有的文件（含空目录） */
    private fun cleanStale(root: File, keep: Set<String>) {
        val all = root.walkTopDown().filter { it.isFile }.toList()
        for (file in all) {
            val relative = file.relativeTo(root).invariantSeparatorsPath
            if (relative == "manifest.json" || relative == "version.json") continue
            if (!keep.contains(relative)) file.delete()
        }
        // 自下而上删空目录
        root.walkBottomUp().filter { it.isDirectory && it != root }.forEach { dir ->
            if (dir.listFiles()?.isEmpty() == true) dir.delete()
        }
    }

    /**
     * 下载单个文件到 target，返回写入字节数；失败返回 -1。
     * 镜像格式是"前缀 + 原始地址"，主站那条前缀为空串，直接拼路径。
     */
    private fun download(
        url: String,
        target: File,
        doneBytes: Long,
        totalBytes: Long,
        path: String,
        index: Int,
        total: Int,
        onProgress: (Progress) -> Unit
    ): Long {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                requestMethod = "GET"
                instanceFollowRedirects = true
                setRequestProperty("Accept", "*/*")
            }
            val code = connection.responseCode
            if (code !in 200..299) return -1

            var written = 0L
            var lastReport = 0L
            connection.inputStream.use { input ->
                FileOutputStream(target).use { output ->
                    val buffer = ByteArray(16 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        output.write(buffer, 0, read)
                        written += read
                        if (written - lastReport >= PROGRESS_STEP) {
                            lastReport = written
                            onProgress(Progress(index + 1, total, path, doneBytes + written, totalBytes))
                        }
                    }
                    output.flush()
                }
            }
            onProgress(Progress(index + 1, total, path, doneBytes + written, totalBytes))
            written
        } catch (error: Throwable) {
            -1
        } finally {
            try {
                connection?.disconnect()
            } catch (ignored: Throwable) {
                /* 忽略 */
            }
        }
    }

    /** 下载并解析目标清单（优先 GitHub Pages 镜像，失败回退 Supabase 拼出来的清单） */
    fun fetchManifest(manifestUrl: String): JSONObject? {
        if (manifestUrl.isNotEmpty()) {
            for (source in listOf("https://gh.dpik.top/", "https://gh.llkk.cc/", "")) {
                val url = if (source.isEmpty()) manifestUrl else source + manifestUrl
                val text = httpGetText(url)
                if (text != null) {
                    val json = try {
                        JSONObject(text)
                    } catch (error: Throwable) {
                        null
                    }
                    if (json != null && json.optJSONArray("files") != null) return json
                }
            }
        }
        return fromSupabase()
    }

    /** 回退：把 Supabase 的 app_web_manifest 表拼成同样结构的清单 */
    private fun fromSupabase(): JSONObject? {
        val url = "https://kmzcebxhewlihgqzfaqw.supabase.co/rest/v1/" +
            "app_web_manifest?select=path,hash,bytes&limit=1000" +
            "&apikey=sb_publishable_woB0DFosxaxHE1101sjfHA_Bt0SJMxG"
        val text = httpGetText(url, "Bearer sb_publishable_woB0DFosxaxHE1101sjfHA_Bt0SJMxG") ?: return null
        return try {
            val rows = org.json.JSONArray(text)
            val files = org.json.JSONArray()
            for (index in 0 until rows.length()) {
                val row = rows.optJSONObject(index) ?: continue
                val item = JSONObject()
                item.put("path", row.optString("path"))
                item.put("hash", row.optString("hash"))
                item.put("bytes", row.optInt("bytes", 0))
                files.put(item)
            }
            if (files.length() == 0) null else JSONObject().put("files", files)
        } catch (error: Throwable) {
            null
        }
    }

    private fun httpGetText(url: String, authorization: String? = null): String? {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                requestMethod = "GET"
                instanceFollowRedirects = true
                if (authorization != null) setRequestProperty("Authorization", authorization)
                setRequestProperty("Accept", "application/json")
            }
            if (connection.responseCode !in 200..299) return null
            connection.inputStream.bufferedReader().use { it.readText() }
        } catch (error: Throwable) {
            null
        } finally {
            try {
                connection?.disconnect()
            } catch (ignored: Throwable) {
                /* 忽略 */
            }
        }
    }

    private fun sha256(file: File): String? {
        return try {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(32 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read <= 0) break
                    digest.update(buffer, 0, read)
                }
            }
            digest.digest().joinToString("") { "%02x".format(it) }
        } catch (error: Throwable) {
            null
        }
    }

    private fun copyAssetTree(context: Context, from: String, to: File) {
        val assets = context.assets
        val children = assets.list(from) ?: return
        if (children.isEmpty()) {
            // 是文件
            to.parentFile?.mkdirs()
            assets.open(from).use { input -> FileOutputStream(to).use { input.copyTo(it) } }
            return
        }
        to.mkdirs()
        for (child in children) copyAssetTree(context, "$from/$child", File(to, child))
    }

    private fun copyTree(from: File, to: File) {
        if (from.isFile) {
            to.parentFile?.mkdirs()
            from.copyTo(to, overwrite = true)
            return
        }
        to.mkdirs()
        from.listFiles()?.forEach { copyTree(it, File(to, it.name)) }
    }
}
