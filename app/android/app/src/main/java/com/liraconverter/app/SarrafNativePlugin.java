package com.liraconverter.app;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/** جسر صغير بين واجهة الويب وأندرويد: الويدجت، المنبّه الصباحي الدقيق، حالة توفير البطارية */
@CapacitorPlugin(name = "SarrafNative")
public class SarrafNativePlugin extends Plugin {

    /** {rows:[{key,label,value}], usd, usdDir, g21, goldOn, mode, at} → الويدجتات (بترتيب المستخدم) */
    @PluginMethod
    public void updateWidget(PluginCall call) {
        Context c = getContext();
        try {
            JSONObject o = new JSONObject(call.getData().toString());
            if (!o.has("at")) o.put("at", System.currentTimeMillis());
            SarrafData.prefs(c).edit().putString("widget", o.toString()).apply();
        } catch (Exception e) { call.reject(e.getMessage()); return; }
        RatesWidget.updateAll(c);
        call.resolve();
    }

    /** {enabled, times:["09:00","14:00"] بتوقيت دمشق, title, body} → يجدول المنبّه الدقيق لأقرب موعد */
    @PluginMethod
    public void setMorning(PluginCall call) {
        Context c = getContext();
        try {
            JSONObject prev = SarrafData.appJson(c, "morning");
            JSONObject o = prev == null ? new JSONObject() : prev;
            if (call.hasOption("enabled")) o.put("enabled", call.getBoolean("enabled", false));
            if (call.hasOption("time")) o.put("time", call.getString("time", "09:00"));
            if (call.hasOption("times")) o.put("times", new org.json.JSONArray(call.getArray("times").toString()));
            if (call.hasOption("title")) o.put("title", call.getString("title"));
            if (call.hasOption("body")) { o.put("body", call.getString("body")); o.put("bodyAt", System.currentTimeMillis()); }
            SarrafData.prefs(c).edit().putString("morning", o.toString()).apply();
        } catch (Exception e) { call.reject(e.getMessage()); return; }
        long at = MorningAlarm.schedule(c);
        JSObject r = new JSObject();
        r.put("nextAt", at);
        r.put("exact", MorningAlarm.canExact(c));
        call.resolve(r);
    }

    /** إشعار تجريبي فوري بنفس مسار الإشعار الصباحي */
    @PluginMethod
    public void fireMorningNow(PluginCall call) {
        MorningAlarm.post(getContext());
        call.resolve();
    }

    /** هل النظام ممكن يأخّر أو يمنع الإشعار؟ */
    @PluginMethod
    public void status(PluginCall call) {
        Context c = getContext();
        JSObject r = new JSObject();
        boolean ignoring = true;
        if (Build.VERSION.SDK_INT >= 23) {
            PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
            ignoring = pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName());
        }
        boolean restricted = false;
        if (Build.VERSION.SDK_INT >= 28) {
            ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
            restricted = am != null && am.isBackgroundRestricted();
        }
        r.put("ignoringBattery", ignoring);
        r.put("backgroundRestricted", restricted);
        r.put("exact", MorningAlarm.canExact(c));
        r.put("sdk", Build.VERSION.SDK_INT);
        r.put("manufacturer", Build.MANUFACTURER);
        long next = MorningAlarm.nextTrigger(c, System.currentTimeMillis());
        r.put("nextAt", next);
        call.resolve(r);
    }

    // ================= تحديث الـ APK من جوا التطبيق =================

    /** {url} → تنزيل الـ APK مع حدث تقدّم "apkProgress" {pct}. يرجع {path, versionCode} */
    @PluginMethod
    public void downloadApk(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) { call.reject("رابط غير صالح"); return; }
        new Thread(() -> {
            java.io.File dir = new java.io.File(getContext().getCacheDir(), "updates");
            java.io.File out = new java.io.File(dir, "sarraf.apk");
            try {
                dir.mkdirs();
                java.net.HttpURLConnection con = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                con.setInstanceFollowRedirects(true);
                con.setConnectTimeout(15000);
                con.setReadTimeout(30000);
                int code = con.getResponseCode();
                if (code != 200) throw new Exception("HTTP " + code);
                long total = con.getContentLengthLong(), got = 0;
                int lastPct = -1;
                try (java.io.InputStream in = new java.io.BufferedInputStream(con.getInputStream());
                     java.io.OutputStream os = new java.io.FileOutputStream(out)) {
                    byte[] buf = new byte[32768];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        os.write(buf, 0, n);
                        got += n;
                        if (got > 80L * 1024 * 1024) throw new Exception("الملف أكبر من المتوقع");
                        int pct = total > 0 ? (int) (got * 100 / total) : -1;
                        if (pct != lastPct) {
                            lastPct = pct;
                            JSObject p = new JSObject();
                            p.put("pct", pct);
                            p.put("bytes", got);
                            notifyListeners("apkProgress", p);
                        }
                    }
                } finally { con.disconnect(); }
                // تحقق: نفس الحزمة ورقم نسخة أحدث (ما منثبّت ملف غريب)
                android.content.pm.PackageManager pm = getContext().getPackageManager();
                android.content.pm.PackageInfo info = pm.getPackageArchiveInfo(out.getAbsolutePath(), 0);
                if (info == null || !getContext().getPackageName().equals(info.packageName)) { out.delete(); throw new Exception("الملف مو تطبيق صرّاف"); }
                long cur = pm.getPackageInfo(getContext().getPackageName(), 0).versionCode;
                if (info.versionCode <= cur) { out.delete(); throw new Exception("النسخة المنزّلة مو أحدث من الموجودة"); }
                JSObject r = new JSObject();
                r.put("path", out.getAbsolutePath());
                r.put("versionCode", info.versionCode);
                call.resolve(r);
            } catch (Exception e) {
                out.delete();
                call.reject(String.valueOf(e.getMessage()));
            }
        }).start();
    }

    /** فتح شاشة التثبيت للملف المنزّل. يرجع {needPermission:true} إذا لازم "تثبيت تطبيقات غير معروفة" */
    @PluginMethod
    public void installApk(PluginCall call) {
        Context c = getContext();
        java.io.File f = new java.io.File(new java.io.File(c.getCacheDir(), "updates"), "sarraf.apk");
        JSObject r = new JSObject();
        if (!f.exists()) { call.reject("ما في ملف منزّل"); return; }
        if (Build.VERSION.SDK_INT >= 26 && !c.getPackageManager().canRequestPackageInstalls()) {
            r.put("needPermission", true);
            call.resolve(r);
            return;
        }
        try {
            Uri uri = androidx.core.content.FileProvider.getUriForFile(c, c.getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
            r.put("needPermission", false);
            call.resolve(r);
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    /** أندرويد 8+: صفحة "السماح بالتثبيت من هالمصدر" لتطبيق صرّاف */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 26) {
            start(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName())), call);
        } else start(new Intent(Settings.ACTION_SECURITY_SETTINGS), call);
    }

    // ================= التحديث الهوائي (OTA) =================

    /** {url, sha256, build} → تنزيل الحزمة والتحقق منها وفك ضغطها. يرجع {path} */
    @PluginMethod
    public void otaDownload(PluginCall call) {
        final String url = call.getString("url");
        final String sha = call.getString("sha256");
        final int build = call.getInt("build", 0);
        if (url == null || sha == null || build <= 0) { call.reject("بيانات ناقصة"); return; }
        if (Ota.isBad(getContext(), build)) { call.reject("الحزمة معلّمة كمعطوبة"); return; }
        new Thread(() -> {
            try {
                String path = Ota.download(getContext(), url, sha, build);
                JSObject r = new JSObject();
                r.put("path", path);
                call.resolve(r);
            } catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
        }).start();
    }

    /** {path, build, now} → تفعيل الحزمة. now=true بيعيد تحميل الواجهة فوراً */
    @PluginMethod
    public void otaApply(PluginCall call) {
        String path = call.getString("path");
        int build = call.getInt("build", 0);
        boolean now = call.getBoolean("now", false);
        try {
            Ota.apply(getContext(), path, build, now);
        } catch (Exception e) { call.reject(e.getMessage()); return; }
        call.resolve();
        if (now) getBridge().setServerBasePath(path);
    }

    /** الواجهة اشتغلت تمام: تثبيت الحزمة الحالية */
    @PluginMethod
    public void otaReady(PluginCall call) {
        JSObject r = new JSObject();
        r.put("build", Ota.ready(getContext()));
        call.resolve(r);
    }

    /** {build: الحزمة الحالية، bad: الحزم المعطوبة، versionCode: رقم الـ APK} */
    @PluginMethod
    public void otaInfo(PluginCall call) {
        Context c = getContext();
        JSObject r = new JSObject();
        r.put("build", SarrafData.prefs(c).getInt("otaCurrent", 0));
        String act = Ota.cap(c).getString(Ota.CAP_PATH, null);
        r.put("active", act != null && !act.isEmpty());
        r.put("bad", Ota.badList(c).toString());
        try {
            r.put("versionCode", c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionCode);
        } catch (Exception e) { r.put("versionCode", 0); }
        call.resolve(r);
    }

    /** رجوع للواجهة المدمجة بالـ APK */
    @PluginMethod
    public void otaReset(PluginCall call) {
        Ota.reset(getContext());
        call.resolve();
        getBridge().setServerAssetPath("public");
    }

    /** صفحة التطبيق بالإعدادات (منها: البطارية ← بدون قيود) */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        start(i, call);
    }

    /** قائمة "تحسين البطارية" بالنظام */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        start(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS), call);
    }

    /** أندرويد 12+: صلاحية "المنبّهات والتذكيرات" */
    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 31) {
            start(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName())), call);
        } else call.resolve();
    }

    private void start(Intent i, PluginCall call) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent f = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
                f.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(f);
                call.resolve();
            } catch (Exception e2) { call.reject(e2.getMessage()); }
        }
    }
}
