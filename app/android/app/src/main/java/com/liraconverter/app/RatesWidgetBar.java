package com.liraconverter.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** ويدجت 4×1 الشريط السريع: الدولار/سوري · التركي/سوري · ذهب عيار 21 بالدولار + تحديث فوري */
public class RatesWidgetBar extends AppWidgetProvider {

    static void render(Context c, AppWidgetManager m, int[] ids, boolean refreshing) {
        SarrafData.runner(c).edit().putString("widgetOn", "true").apply();
        SarrafData.Snapshot s = SarrafData.latest(c);
        String arrow = s == null ? "" : s.usdDir > 0 ? "▲" : s.usdDir < 0 ? "▼" : "";
        int arrowColor = s != null && s.usdDir < 0 ? 0xFFF87171 : 0xFF22C55E;

        String usdPair = (s == null || Double.isNaN(s.usdBuy)) ? "—"
            : SarrafData.fmt(s.usdBuy, 1) + "/" + SarrafData.fmt(s.usdSell, 1);
        String tryPair = (s == null || Double.isNaN(s.tryBuy)) ? "—"
            : SarrafData.fmt(s.tryBuy, 2) + "/" + SarrafData.fmt(s.trySell, 2);

        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_bar);
            v.setTextViewText(R.id.wb_usd_arrow, arrow);
            v.setTextColor(R.id.wb_usd_arrow, arrowColor);
            v.setTextViewText(R.id.wb_usd_pair, usdPair);
            v.setTextViewText(R.id.wb_try_pair, tryPair);
            v.setTextViewText(R.id.wb_gold_usd, s == null ? "—" : SarrafData.fmtUsd(s.g21Usd, 1));
            v.setTextViewText(R.id.wb_gold_syp, (s == null || Double.isNaN(s.g21Syp)) ? "بالدولار" : (SarrafData.fmt(s.g21Syp, 0) + " ل.س"));
            v.setTextViewText(R.id.wb_time, refreshing ? "جاري التحديث…" : SarrafData.widgetTimeLabel(s, true));

            PendingIntent pi = RatesWidget.openApp(c, 7003);
            if (pi != null) v.setOnClickPendingIntent(R.id.wb_root, pi);
            v.setOnClickPendingIntent(R.id.wb_refresh, RatesWidget.refreshIntent(c, RatesWidgetBar.class, 7103));
            m.updateAppWidget(id, v);
        }
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        super.onReceive(c, intent);
        if (RatesWidget.ACTION_REFRESH.equals(intent == null ? null : intent.getAction())) {
            RatesWidget.handleRefreshClick(c);
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
