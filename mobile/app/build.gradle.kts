plugins { id("com.android.application") }

android {
  namespace = "com.dogoffurina.homeworkshower"
  compileSdk = 34

  defaultConfig {
    applicationId = "com.dogoffurina.homeworkshower"
    minSdk = 24
    targetSdk = 34
    versionCode = 2
    versionName = "1.1"
  }

  buildTypes {
    release {
      isMinifyEnabled = false
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}

dependencies {
  // 只为了 WebViewAssetLoader（让页面走 https 虚拟域名，登录态才存得住）
  implementation("androidx.webkit:webkit:1.11.0")
}
