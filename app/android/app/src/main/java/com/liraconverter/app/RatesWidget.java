package com.liraconverter.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

/** ويدجت متوسطة 4×2: أول 3 عملات حسب ترتيب المستخدم + غرام عيار 21 + وقت التحديث */
public class RatesWidget extends AppWidgetProvider {

    static final int[] ROW = { R.id.w_row1, R.id.w_row2, R.id.w_row3 };
    static final int[] LABEL = { R.id.w_l1, R.id.w_l2, R.id.w_l3 };
    static final int[] VALUE = { R.id.w_v1, R.id.w_v2, R.id.w_v3 };

    /** تحديث كل الويدجتات (الكبيرة والصغيرة) */
    public static void updateAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] big = m.getAppWidgetIds(new ComponentName(c, RatesWidget.class));
        if (big != null && big.length > 0) render(c, m, big);
        int[] small = m.getAppWidgetIds(new ComponentName(c, RatesWidgetSmall.class));
        if (small != null && small.length > 0) RatesWidgetSmall.render(c, m, small);
    }

    static PendingIntent openApp(Context c, int req) {
        Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (open == null) return null;
        return PendingIntent.getActivity(c, req, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void render(Context c, AppWidgetManager m, int[] ids) {
        SarrafData.Snapshot s = SarrafData.latest(c);
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_rates);
            for (int i = 0; i < 3; i++) {
                if (s != null && i < s.rows.size()) {
                    SarrafData.Row row = s.rows.get(i);
                    v.setViewVisibility(ROW[i], View.VISIBLE);
                    v.setTextViewText(LABEL[i], row.label);
                    v.setTextViewText(VALUE[i], SarrafData.fmt(row.value, row.value >= 1000 ? 0 : 2));
                } else v.setViewVisibility(ROW[i], s == null && i == 0 ? View.VISIBLE : View.GONE);
            }
            if (s == null) {
                v.setTextViewText(LABEL[0], "الدولار");
                v.setTextViewText(VALUE[0], "—");
            }
            boolean gold = s == null || s.goldOn;
            v.setViewVisibility(R.id.w_rowg, gold ? View.VISIBLE : View.GONE);
            v.setTextViewText(R.id.w_gold, s == null ? "—" : SarrafData.fmt(s.g21, 0));
            v.setTextViewText(R.id.w_time, s == null ? "افتح التطبيق مرة" : "تحديث " + SarrafData.timeOf(s.at));
            PendingIntent pi = openApp(c, 7001);
            if (pi != null) v.setOnClickPendingIntent(R.id.w_root, pi);
            m.updateAppWidget(id, v);
        }
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) { render(c, m, ids); }

    // نخبّر الـ runner إنو في ويدجت، مشان يحدّث الأسعار بالخلفية كل نص ساعة تقريباً
    @Override
    public void onEnabled(Context c) { SarrafData.runner(c).edit().putString("widgetOn", "true").apply(); }

    @Override
    public void onDisabled(Context c) {
        // ما منطفي الخلفية إذا الويدجت الصغيرة لسا موجودة
        int[] small = AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c, RatesWidgetSmall.class));
        if (small == null || small.length == 0) SarrafData.runner(c).edit().putString("widgetOn", "false").apply();
    }
}
