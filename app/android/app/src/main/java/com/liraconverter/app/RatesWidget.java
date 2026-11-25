package com.liraconverter.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** ويدجت 4×2 احترافية: شبكة 2×2 (الدولار، التركي، اليورو، ذهب عيار 21 بالدولار + سوري) مع زر تحديث فوري */
public class RatesWidget extends AppWidgetProvider {

    public static final String ACTION_REFRESH = "com.liraconverter.app.WIDGET_REFRESH";

    /** تحديث كل الويدجتات الأربعة معاً */
    public static void updateAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] big = m.getAppWidgetIds(new ComponentName(c, RatesWidget.class));
        if (big != null && big.length > 0) render(c, m, big, false);
        int[] small = m.getAppWidgetIds(new ComponentName(c, RatesWidgetSmall.class));
        if (small != null && small.length > 0) RatesWidgetSmall.render(c, m, small, false);
        int[] bar = m.getAppWidgetIds(new ComponentName(c, RatesWidgetBar.class));
        if (bar != null && bar.length > 0) RatesWidgetBar.render(c, m, bar, false);
        int[] full = m.getAppWidgetIds(new ComponentName(c, RatesWidgetFull.class));
        if (full != null && full.length > 0) RatesWidgetFull.render(c, m, full, false);
    }

    /** إظهار حالة "جاري التحديث…" على جميع الويدجتات فوراً عند ضغط ↻ */
    public static void showRefreshingAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] big = m.getAppWidgetIds(new ComponentName(c, RatesWidget.class));
        if (big != null && big.length > 0) render(c, m, big, true);
        int[] small = m.getAppWidgetIds(new ComponentName(c, RatesWidgetSmall.class));
        if (small != null && small.length > 0) RatesWidgetSmall.render(c, m, small, true);
        int[] bar = m.getAppWidgetIds(new ComponentName(c, RatesWidgetBar.class));
        if (bar != null && bar.length > 0) RatesWidgetBar.render(c, m, bar, true);
        int[] full = m.getAppWidgetIds(new ComponentName(c, RatesWidgetFull.class));
        if (full != null && full.length > 0) RatesWidgetFull.render(c, m, full, true);
    }

    static PendingIntent openApp(Context c, int req) {
        Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (open == null) return null;
        return PendingIntent.getActivity(c, req, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent refreshIntent(Context c, Class<?> provider, int req) {
        Intent i = new Intent(c, provider).setAction(ACTION_REFRESH);
        return PendingIntent.getBroadcast(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void handleRefreshClick(Context c) {
        if (!SarrafData.isNetworkAvailable(c)) {
            updateAll(c); // بلا نت: لا نترك الويدجت عالقة على "جاري التحديث…"
            return;
        }
        showRefreshingAll(c);
        RatesSyncWorker.triggerImmediateRefresh(c);
    }

    static void render(Context c, AppWidgetManager m, int[] ids, boolean refreshing) {
        SarrafData.runner(c).edit().putString("widgetOn", "true").apply();
        SarrafData.Snapshot s = SarrafData.latest(c);
        String arrow = s == null ? "" : s.usdDir > 0 ? "▲" : s.usdDir < 0 ? "▼" : "";
        int arrowColor = s != null && s.usdDir < 0 ? 0xFFF87171 : 0xFF22C55E;

        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_rates);
            v.setTextViewText(R.id.w_time, refreshing ? "جاري التحديث…" : SarrafData.widgetTimeLabel(s, false));
            v.setTextViewText(R.id.w_usd_arrow, arrow);
            v.setTextColor(R.id.w_usd_arrow, arrowColor);

            v.setTextViewText(R.id.w_usd_b, s == null ? "—" : SarrafData.fmt(s.usdBuy, 2));
            v.setTextViewText(R.id.w_usd_s, s == null ? "—" : SarrafData.fmt(s.usdSell, 2));
            v.setTextViewText(R.id.w_try_b, s == null ? "—" : SarrafData.fmt(s.tryBuy, 2));
            v.setTextViewText(R.id.w_try_s, s == null ? "—" : SarrafData.fmt(s.trySell, 2));
            v.setTextViewText(R.id.w_eur_b, s == null ? "—" : SarrafData.fmt(s.eurBuy, 2));
            v.setTextViewText(R.id.w_eur_s, s == null ? "—" : SarrafData.fmt(s.eurSell, 2));

            v.setTextViewText(R.id.w_gold_usd, s == null ? "—" : SarrafData.fmtUsd(s.g21Usd, 1));
            v.setTextViewText(R.id.w_gold_syp, (s == null || Double.isNaN(s.g21Syp)) ? "بالدولار" : (SarrafData.fmt(s.g21Syp, 0) + " ل.س"));
            v.setTextViewText(R.id.w_gold_tag, s == null ? "" : (s.goldLocal ? "محلي" : "تقديري"));

            PendingIntent pi = openApp(c, 7001);
            if (pi != null) v.setOnClickPendingIntent(R.id.w_root, pi);
            v.setOnClickPendingIntent(R.id.w_refresh, refreshIntent(c, RatesWidget.class, 7101));
            m.updateAppWidget(id, v);
        }
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        super.onReceive(c, intent);
        if (ACTION_REFRESH.equals(intent == null ? null : intent.getAction())) {
            handleRefreshClick(c);
        }
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        render(c, m, ids, false);
        RatesSyncWorker.ensureScheduled(c);
    }

    @Override
    public void onEnabled(Context c) {
        SarrafData.runner(c).edit().putString("widgetOn", "true").apply();
        RatesSyncWorker.ensureScheduled(c);
    }

    @Override
    public void onDisabled(Context c) {
        if (!SarrafData.hasAnyWidget(c)) SarrafData.runner(c).edit().putString("widgetOn", "false").apply();
    }
}
