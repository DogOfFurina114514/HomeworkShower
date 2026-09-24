package com.dogoffurina.homeworkshower

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * 本体更新：下载新版安装包并交给系统安装器。
 *
 * 与热更新共用 version.json 里的信息：
 *   apkUrlTemplate 形如 https://github.com/.../releases/download/{version}/HomeworkShower_{version}.apk
 *   apkMirrors     镜像前缀，依次尝试；空串代表直连原始地址
 *
 * 强制更新遵循"累积性"：本地 version_code < apkMandatorySince 就强制，
 * 不能跳过中间出现过的强制版本（见 mobile/README.md）。
 */
object ApkUpdater {

    private const val TIMEOUT_MS = 20000

    class Progress(val doneBytes: Long, val totalBytes: Long) {
        /** 0~100；总大小未知时返回 -1 */
        val percent: Int get() = if (totalBytes > 0) ((doneBytes * 100) / totalBytes).toInt() else -1
    }

    class Result(val file: File?, val message: String)

    /** 安装包放这里：应用专属外部目录，不需要存储权限 */
    private fun apkFile(context: Context, version: String): File {
        val dir = File(context.getExternalFilesDir(null) ?: context.filesDir, "apk")
        dir.mkdirs()
        return File(dir, "HomeworkShower_$version.apk")
    }

    /** 拼出所有候选下载地址：镜像前缀 × 原始地址（前缀为空串时就是原始地址） */
    private fun candidates(info: UpdateChecker.VersionInfo): List<String> {
        val template = info.apkUrlTemplate
        if (template.isEmpty()) return emptyList()
        val base = template.replace("{version}", info.apkVersion)
        val mirrors = info.apkMirrors.ifEmpty { listOf("https://gh.dpik.top/", "https://gh.llkk.cc/", "") }
        return mirrors.map { if (it.isEmpty()) base else it + base }
    }

    /**
     * 下载安装包。同步阻塞，必须放在后台线程。
     * @return 下载好的文件；失败时 file 为 null，message 里是原因
     */
    fun download(
        context: Context,
        info: UpdateChecker.VersionInfo,
        onProgress: (Progress) -> Unit = {},
        isCancelled: () -> Boolean = { false }
    ): Result {
        val urls = candidates(info)
        if (urls.isEmpty()) return Result(null, "版本信息里没有下载地址")

        val target = apkFile(context, info.apkVersion)
        // 已经有完整包（大小与上次一致）就直接复用
        var lastError = "下载失败"
        for (url in urls) {
            if (isCancelled()) return Result(null, "已取消")
            val ok = try {
                fetch(url, target, onProgress, isCancelled)
            } catch (error: Throwable) {
                lastError = error.message ?: "下载失败"
                false
            }
            if (ok) return Result(target, "已下载")
            target.delete()
        }
        return Result(null, lastError)
    }

    private fun fetch(
        url: String,
        target: File,
        onProgress: (Progress) -> Unit,
        isCancelled: () -> Boolean
    ): Boolean {
        var connection: HttpURLConnection? = null
        try {
            connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                requestMethod = "GET"
                instanceFollowRedirects = true
                setRequestProperty("Accept", "*/*")
            }
            val code = connection.responseCode
            if (code !in 200..299) return false

            val total = connection.contentLengthLong
            var done = 0L
            connection.inputStream.use { input ->
                FileOutputStream(target).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        if (isCancelled()) return false
                        val read = input.read(buffer)
                        if (read <= 0) break
                        output.write(buffer, 0, read)
                        done += read
                        // 每 128 KB 报一次，界面上的百分比才动得起来
                        onProgress(Progress(done, total))
                    }
                    output.flush()
                }
            }
            onProgress(Progress(done, total))

            // 完整性校验：
            //   1. 有 Content-Length 就必须一模一样（下到半截的包装上去会报
            //      “Archive is not a ZIP archive”，绝对不能当成功）；
            //   2. 开头必须是 ZIP 的 "PK\x03\x04" —— 有些镜像会把二进制按文本转发，
            //      下下来的其实是错误页，字节数看着正常但根本不是安装包。
            if (total > 0 && done != total) return false
            if (!looksLikeZip(target)) return false
            return true
        } finally {
            try {
                connection?.disconnect()
            } catch (ignored: Throwable) {
                /* 忽略 */
            }
        }
    }

    /** 文件头是不是 ZIP（APK 就是 ZIP）：PK\x03\x04 */
    private fun looksLikeZip(file: File): Boolean {
        return try {
            file.inputStream().use { input ->
                val head = ByteArray(4)
                if (input.read(head) != 4) return false
                head[0] == 0x50.toByte() && head[1] == 0x4B.toByte() &&
                    head[2] == 0x03.toByte() && head[3] == 0x04.toByte()
            }
        } catch (error: Throwable) {
            false
        }
    }

    /**
     * 交给系统安装器。Android 8+ 需要"安装未知应用"权限，
     * 这里用 FileProvider 给安装器一个可读的 content:// 地址。
     */
    fun install(context: Context, file: File) {
        val uri: Uri = FileProvider.getUriForFile(
            context,
            context.packageName + ".fileprovider",
            file
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }
}
