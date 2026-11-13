# قواعد R8 لتطبيق صرّاف (minify + shrinkResources)

# Capacitor: الإضافات تُستدعى بالانعكاس (reflection) حسب الاسم
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keep public class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * { @com.getcapacitor.PluginMethod public <methods>; }
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod

# جسر JavaScript ↔ أندرويد بالـ WebView
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }

# Background Runner: محرك JS أصلي (JNI) يستدعي كلاسات Kotlin بالاسم
-keep class io.ionic.android_js_engine.** { *; }
-keep class io.ionic.backgroundrunner.** { *; }
-keepclasseswithmembernames class * { native <methods>; }

# WorkManager (يشغّل الـ runner بالخلفية)
-keep class * extends androidx.work.ListenableWorker { <init>(...); }

# كلاسات التطبيق (ويدجت + منبّه + جسر)
-keep class com.liraconverter.app.** { *; }

# الإضافات الرسمية
-keep class com.capacitorjs.plugins.** { *; }

-dontwarn org.jetbrains.annotations.**
-dontwarn kotlinx.**
