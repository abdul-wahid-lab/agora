plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.abdulwahidlab.agora_mobile"
    // Pinned explicitly, not flutter.compileSdkVersion - file_picker's
    // transitive flutter_plugin_android_lifecycle dependency requires
    // compiling against API 36+; Flutter's own bundled default was lower
    // and the build failed outright (CheckAarMetadataWorkAction) until
    // this was raised to match.
    compileSdk = 36
    // Pinned explicitly, not flutter.ndkVersion - whisper_ggml's native
    // build needs 29.0.13113456, newer than Flutter's own default; Gradle
    // auto-installed and used it anyway on the first real build, this just
    // makes that choice explicit instead of implicit/silent.
    ndkVersion = "29.0.13113456"

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.abdulwahidlab.agora_mobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        // 24, not Flutter's own default (21) - whisper_ggml's on-device
        // transcription (lib/backend/transcribe.dart) requires API 24+.
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
