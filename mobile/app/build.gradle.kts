plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "com.dogoffurina.homeworkshower"
  compileSdk = 34

  defaultConfig {
    applicationId = "com.dogoffurina.homeworkshower"
    minSdk = 24
    targetSdk = 34
    versionCode = 3
    versionName = "1.2"
  }

  buildTypes {
    release { isMinifyEnabled = false }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions { jvmTarget = "17" }
}

dependencies {
  implementation("androidx.webkit:webkit:1.11.0")
}
