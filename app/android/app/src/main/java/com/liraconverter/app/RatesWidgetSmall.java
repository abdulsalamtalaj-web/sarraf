package com.liraconverter.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** ويدجت 2×1 احترافية: الدولار مقابل السوري (شراء ومبيع + سهم + تحديث فوري) */
public class RatesWidgetSmall extends AppWidgetProvider {

    static void render(Context c, AppWidgetManager m, int[] ids, boolean refreshing) {
        SarrafData.runner(c).edit().putString("widgetOn", "true").apply();
        SarrafData.Snapshot s = SarrafData.latest(c);
        String arrow = s == null ? "" : s.usdDir > 0 ? "▲" : s.usdDir < 0 ? "▼" : "";
        int arrowColor = s != null && s.usdDir < 0 ? 0xFFF87171 : 0xFF22C55E;

        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_small);
            v.setTextViewText(R.id.ws_buy, s == null ? "—" : SarrafData.fmt(s.usdBuy, 2));
            v.setTextViewText(R.id.ws_sell, s == null ? "—" : SarrafData.fmt(s.usdSell, 2));
            v.setTextViewText(R.id.ws_arrow, arrow);
            v.setTextColor(R.id.ws_arrow, arrowColor);
            v.setTextViewText(R.id.ws_time, refreshing ? "تحديث…" : SarrafData.widgetTimeLabel(s, true));

            PendingIntent pi = RatesWidget.openApp(c, 7002);
            if (pi != null) v.setOnClickPendingIntent(R.id.ws_root, pi);
            v.setOnClickPendingIntent(R.id.ws_refresh, RatesWidget.refreshIntent(c, RatesWidgetSmall.class, 7102));
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
