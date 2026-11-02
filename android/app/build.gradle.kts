plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// The site the app talks to (the APP_URL repository variable) and the build number.
val appHost: String = (System.getenv("APP_HOST") ?: "").ifBlank { "quantpocket.onrender.com" }.trimEnd('/')
    .let { if (it.startsWith("http")) it else "https://$it" }
val versionNumber: Int = (System.getenv("VERSION_CODE") ?: "1").toIntOrNull() ?: 1

android {
    namespace = "com.brightfolio.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.brightfolio.app"
        minSdk = 24
        targetSdk = 35
        versionCode = versionNumber
        versionName = "2.0.$versionNumber"
        buildConfigField("String", "BASE_URL", "\"$appHost\"")
    }
    buildFeatures { compose = true; buildConfig = true }
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
    val bom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(bom)
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.browser:browser:1.8.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
