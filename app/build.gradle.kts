plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "app.openframe"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.openframe"
        minSdk = 27
        // The app only ever runs on the frame (Android 8.1). Targeting 27 keeps
        // platform behavior identical to what the device actually implements.
        targetSdk = 27
        versionCode = 4
        versionName = "1.0.2"
    }

    // The user's own key signs both build types (V1.0.0, 2026-10-19), so test and release builds update each
    // other in place. Path and password come from scripts/env.ps1 (signing-setup.ps1); never from the repo.
    val keystore = System.getenv("OPENFRAME_KEYSTORE")
    val keystorePassword = System.getenv("OPENFRAME_KEYSTORE_PASSWORD")
    val ownKey = if (keystore != null && keystorePassword != null) signingConfigs.create("openframe") {
        storeFile = file(keystore)
        storePassword = keystorePassword
        keyAlias = "openframe"
        keyPassword = keystorePassword
    } else null

    buildTypes {
        debug {
            if (ownKey != null) signingConfig = ownKey
        }
        release {
            isMinifyEnabled = false
            signingConfig = ownKey // null: unsigned (scripts/build-release.ps1 refuses to start without the key)
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    androidResources {
        // Reminder chimes play straight from the APK (AssetManager.openFd needs them stored uncompressed).
        noCompress += "m4a"
    }

    lint {
        // Sideloaded appliance app, never published to Play.
        disable += setOf("ExpiredTargetSdkVersion", "OldTargetApi")
    }
}

dependencies {
    implementation(libs.nanohttpd)
    testImplementation(libs.junit)
    testImplementation(libs.orgjson)
}
