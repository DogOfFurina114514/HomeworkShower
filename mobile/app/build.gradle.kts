plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

// 发布签名：从 mobile/key.properties 读（该文件与 keystore/ 都不入库）。
// 没有这个文件也能构建 —— release 会退回未签名产物，debug 不受影响。
val keyProperties = mutableMapOf<String, String>()
run {
  val file = rootProject.file("key.properties")
  if (file.exists()) {
    file.readLines().forEach { line ->
      val trimmed = line.trim()
      if (trimmed.isEmpty() || trimmed.startsWith("#")) return@forEach
      val index = trimmed.indexOf('=')
      if (index > 0) {
        keyProperties[trimmed.substring(0, index).trim()] = trimmed.substring(index + 1).trim()
      }
    }
  }
}

android {
  namespace = "com.dogoffurina.homeworkshower"
  compileSdk = 34

  defaultConfig {
    applicationId = "com.dogoffurina.homeworkshower"
    minSdk = 24
    targetSdk = 34
    // 版本号规则：26.0.2 = 年份(26).大功能(0).小补丁(2)，打包号 260002
    versionCode = 260002
    versionName = "26.0.2"
  }

  signingConfigs {
    if (keyProperties["storeFile"] != null) {
      create("release") {
        storeFile = rootProject.file(keyProperties.getValue("storeFile"))
        storePassword = keyProperties["storePassword"]
        keyAlias = keyProperties["keyAlias"]
        keyPassword = keyProperties["keyPassword"]
        // 必须同时开 v1(JAR) 与 v2：只出 v2 时，国内不少安装器
        // （MT 管理器、部分华为/小米机型）会因为找不到 META-INF 签名而报
        // “Archive is not a ZIP archive”，装不上。
        enableV1Signing = true
        enableV2Signing = true
      }
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      signingConfig = signingConfigs.findByName("release")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions { jvmTarget = "17" }
}

dependencies {
  implementation("androidx.webkit:webkit:1.11.0")
  // FileProvider：把下载好的安装包以 content:// 交给系统安装器
  implementation("androidx.core:core-ktx:1.13.1")
}
