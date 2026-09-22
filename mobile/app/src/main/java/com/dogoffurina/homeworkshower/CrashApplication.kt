package com.dogoffurina.homeworkshower

import android.app.Application
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 记录未捕获的崩溃。
 *
 * 有些崩溃发生在 Activity 创建之前（例如主题/资源/依赖问题），
 * 那时 Activity 里的 try/catch 根本来不及执行，用户只看到闪退。
 * 这里挂一个全局兜底：把堆栈写进应用私有目录，下次打开时由 MainActivity 显示出来。
 */
class CrashApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                val writer = StringWriter()
                error.printStackTrace(PrintWriter(writer))
                val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.CHINA).format(Date())
                crashFile(this).writeText("时间：$stamp\n线程：${thread.name}\n\n${writer}")
            } catch (ignored: Throwable) {
                // 记录失败也不能再抛
            }
            previous?.uncaughtException(thread, error)
        }
    }

    companion object {
        fun crashFile(context: android.content.Context): File =
            File(context.filesDir, "last-crash.txt")

        fun readCrash(context: android.content.Context): String? {
            val file = crashFile(context)
            return if (file.exists()) file.readText() else null
        }

        fun clearCrash(context: android.content.Context) {
            crashFile(context).delete()
        }
    }
}
