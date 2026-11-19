package com.liraconverter.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * التحديث الهوائي (OTA) لواجهة التطبيق بدون APK جديد.
 * - تنزيل حزمة zip عبر HTTPS + التحقق من SHA-256 + حماية zip-slip و zip-bomb.
 * - حماية من نسخة معطوبة مع حفظ آمن لـ prevPath حتى عند "طبّقه هلأ".
 */
public final class Ota {
    private static final String TAG = "SarrafOta";
    static final String CAP_PREFS = "CapWebViewSettings";
    static final String CAP_PATH = "serverBasePath";
    static final int MAX_BYTES = 15 * 1024 * 1024;
    static final long MAX_UNCOMPRESSED_BYTES = 30L * 1024 * 1024;
    static final int MAX_ENTRIES = 500;

    private Ota() {}

    static SharedPreferences cap(Context c) { return c.getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE); }

    static File root(Context c) { return new File(c.getFilesDir(), "ota"); }

    /** يُستدعى قبل super.onCreate بـ MainActivity: يقرر نرجع للنسخة القديمة أو لا */
    public static void guard(Context c) {
        try {
            // إذا تغيّرت نسخة الـ APK (تحديث كامل) ننظف بقايا OTA القديمة
            long vc = androidx.core.content.pm.PackageInfoCompat.getLongVersionCode(
                c.getPackageManager().getPackageInfo(c.getPackageName(), 0));
            long lastVc = SarrafData.prefs(c).getLong("otaApkVc", -1);
            if (lastVc != vc) {
                reset(c);
                SarrafData.prefs(c).edit().putLong("otaApkVc", vc).commit();
                return;
            }
            JSONObject p = SarrafData.appJson(c, "otaPending");
            if (p == null) return;
            int tries = p.optInt("tries", 0);
            if (tries >= 1) {
                rollback(c, p.optInt("build"), p.optString("prevPath", null));
            } else {
                p.put("tries", tries + 1);
                SarrafData.prefs(c).edit().putString("otaPending", p.toString()).commit();
            }
        } catch (Exception e) {
            Log.w(TAG, "guard failed", e);
        }
    }

    static void rollback(Context c, int badBuild, String prevPath) {
        SharedPreferences.Editor e = cap(c).edit();
        if (prevPath != null && !prevPath.isEmpty() && new File(prevPath).exists()) e.putString(CAP_PATH, prevPath);
        else e.remove(CAP_PATH);
        e.commit();
        try {
            JSONArray bad = badList(c);
            bad.put(badBuild);
            SarrafData.prefs(c).edit().putString("otaBad", bad.toString()).remove("otaPending").commit();
        } catch (Exception ex) {
            Log.w(TAG, "rollback state save failed", ex);
        }
    }

    static JSONArray badList(Context c) {
        try { return new JSONArray(SarrafData.prefs(c).getString("otaBad", "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    static boolean isBad(Context c, int build) {
        JSONArray a = badList(c);
        for (int i = 0; i < a.length(); i++) if (a.optInt(i) == build) return true;
        return false;
    }

    static boolean isInsideRoot(Context c, String path) {
        if (path == null || path.isEmpty()) return false;
        try {
            String base = root(c).getCanonicalPath() + File.separator;
            File target = new File(path);
            return target.getCanonicalPath().startsWith(base) && new File(target, "index.html").exists();
        } catch (Exception e) {
            return false;
        }
    }

    /** تنزيل + تحقق + فك ضغط. يرجع مسار المجلد الجاهز. (يُستدعى بخيط خلفي) */
    public static String download(Context c, String url, String sha256, int build) throws Exception {
        if (url == null || !url.startsWith("https://")) throw new Exception("يجب أن يكون الرابط HTTPS");
        File dir = new File(root(c), String.valueOf(build));
        File zip = new File(c.getCacheDir(), "ota-" + build + ".zip");
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        try {
            con.setInstanceFollowRedirects(true);
            con.setConnectTimeout(15000);
            con.setReadTimeout(30000);
            int code = con.getResponseCode();
            if (code != 200) throw new Exception("HTTP " + code);
            long total = 0;
            try (InputStream in = new BufferedInputStream(con.getInputStream()); OutputStream out = new FileOutputStream(zip)) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > MAX_BYTES) throw new Exception("الحزمة أكبر من المسموح");
                    md.update(buf, 0, n);
                    out.write(buf, 0, n);
                }
            }
        } catch (Exception e) {
            zip.delete();
            throw e;
        } finally {
            con.disconnect();
        }

        String got = hex(md.digest());
        if (sha256 == null || !got.equalsIgnoreCase(sha256.trim())) {
            zip.delete();
            throw new Exception("SHA-256 مو مطابق");
        }
        deleteRec(dir);
        if (!dir.mkdirs() && !dir.exists()) {
            zip.delete();
            throw new Exception("ما قدرنا ننشئ المجلد");
        }
        String base = dir.getCanonicalPath() + File.separator;
        long uncompressedTotal = 0;
        int entries = 0;
        try (ZipInputStream zin = new ZipInputStream(new FileInputStream(zip))) {
            ZipEntry en;
            byte[] buf = new byte[16384];
            while ((en = zin.getNextEntry()) != null) {
                if (++entries > MAX_ENTRIES) throw new Exception("عدد ملفات الحزمة أكبر من المسموح");
                String name = en.getName().replace('\\', '/');
                while (name.startsWith("./")) name = name.substring(2);
                if (name.isEmpty()) continue;
                File f = new File(dir, name);
                if (!f.getCanonicalPath().startsWith(base)) throw new Exception("مسار غير آمن بالحزمة");
                if (en.isDirectory()) { f.mkdirs(); continue; }
                File parent = f.getParentFile();
                if (parent != null) parent.mkdirs();
                try (OutputStream out = new FileOutputStream(f)) {
                    int n;
                    while ((n = zin.read(buf)) > 0) {
                        uncompressedTotal += n;
                        if (uncompressedTotal > MAX_UNCOMPRESSED_BYTES) throw new Exception("حجم الحزمة المفكوك أكبر من المسموح");
                        out.write(buf, 0, n);
                    }
                }
            }
        } catch (Exception e) {
            deleteRec(dir);
            throw e;
        } finally {
            zip.delete();
        }
        if (!new File(dir, "index.html").exists()) { deleteRec(dir); throw new Exception("الحزمة ما فيها index.html"); }
        return dir.getAbsolutePath();
    }

    /** تفعيل الحزمة مع الحفاظ على prevPath الحقيقي حتى لو استُدعيت مرتين (now=false ثم now=true) */
    public static void apply(Context c, String path, int build, boolean now) throws Exception {
        if (!isInsideRoot(c, path)) throw new Exception("مسار الحزمة غير صالح");
        String prev = cap(c).getString(CAP_PATH, null);
        // إصلاح حرج: إذا كانت الحزمة نفسها مسجّلة مسبقاً في CAP_PATH، نحافظ على prevPath من otaPending ولا نكتب المسار الجديد فوقه!
        if (path.equals(prev)) {
            JSONObject existing = SarrafData.appJson(c, "otaPending");
            prev = existing != null ? existing.optString("prevPath", "") : "";
        }
        JSONObject p = new JSONObject();
        p.put("build", build);
        p.put("path", path);
        p.put("prevPath", prev == null ? "" : prev);
        p.put("tries", now ? 1 : 0);
        SarrafData.prefs(c).edit().putString("otaPending", p.toString()).commit();
        cap(c).edit().putString(CAP_PATH, path).commit();
    }

    /** الواجهة الجديدة اشتغلت: نثبّتها ونحذف الحزم القديمة */
    public static int ready(Context c) {
        JSONObject p = SarrafData.appJson(c, "otaPending");
        int build = SarrafData.prefs(c).getInt("otaCurrent", 0);
        if (p != null) {
            build = p.optInt("build");
            SarrafData.prefs(c).edit().remove("otaPending").putInt("otaCurrent", build).apply();
        }
        String cur = cap(c).getString(CAP_PATH, null);
        String curAbs = cur == null ? null : new File(cur).getAbsolutePath();
        File[] old = root(c).listFiles();
        if (old != null) for (File f : old) {
            String fAbs = f.getAbsolutePath();
            if (curAbs == null || (!curAbs.equals(fAbs) && !curAbs.startsWith(fAbs + File.separator))) deleteRec(f);
        }
        return build;
    }

    /** رجوع يدوي للواجهة المدمجة بالـ APK */
    public static void reset(Context c) {
        cap(c).edit().remove(CAP_PATH).commit();
        SarrafData.prefs(c).edit().remove("otaPending").remove("otaCurrent").commit();
        deleteRec(root(c));
    }

    static String hex(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }

    static void deleteRec(File f) {
        if (f == null || !f.exists()) return;
        File[] k = f.listFiles();
        if (k != null) for (File x : k) deleteRec(x);
        f.delete();
    }
}
