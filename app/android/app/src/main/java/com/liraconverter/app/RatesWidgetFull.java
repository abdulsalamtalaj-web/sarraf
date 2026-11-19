package com.liraconverter.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** ويدجت 4×3 لوحة السوق الكاملة: جدول شراء/مبيع لكل العملات + الذهب بكل عياراته بالدولار */
public class RatesWidgetFull extends AppWidgetProvider {

    static void render(Context c, AppWidgetManager m, int[] ids, boolean refreshing) {
        SarrafData.runner(c).edit().putString("widgetOn", "true").apply();
        SarrafData.Snapshot s = SarrafData.latest(c);

        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_full);
            v.setTextViewText(R.id.wf_time, refreshing ? "جاري التحديث…" : SarrafData.widgetTimeLabel(s, false));

            v.setTextViewText(R.id.wf_usd_b, s == null ? "—" : SarrafData.fmt(s.usdBuy, 2));
            v.setTextViewText(R.id.wf_usd_s, s == null ? "—" : SarrafData.fmt(s.usdSell, 2));
            v.setTextViewText(R.id.wf_try_b, s == null ? "—" : SarrafData.fmt(s.tryBuy, 2));
            v.setTextViewText(R.id.wf_try_s, s == null ? "—" : SarrafData.fmt(s.trySell, 2));
            v.setTextViewText(R.id.wf_eur_b, s == null ? "—" : SarrafData.fmt(s.eurBuy, 2));
            v.setTextViewText(R.id.wf_eur_s, s == null ? "—" : SarrafData.fmt(s.eurSell, 2));
            v.setTextViewText(R.id.wf_ut_b, s == null ? "—" : SarrafData.fmt(s.utBuy, 2));
            v.setTextViewText(R.id.wf_ut_s, s == null ? "—" : SarrafData.fmt(s.utSell, 2));

            v.setTextViewText(R.id.wf_g21, s == null ? "—" : SarrafData.fmtUsd(s.g21Usd, 1));
            v.setTextViewText(R.id.wf_g18, s == null ? "—" : SarrafData.fmtUsd(s.g18Usd, 1));
            v.setTextViewText(R.id.wf_g24, s == null ? "—" : SarrafData.fmtUsd(s.g24Usd, 1));
            v.setTextViewText(R.id.wf_glira, s == null ? "—" : SarrafData.fmtUsd(s.gLiraUsd, 0));
            String gMeta = s == null ? "—"
                : ((s.goldLocal ? "محلي" : "تقديري") + (Double.isNaN(s.g21Syp) ? "" : (" · 21 = " + SarrafData.fmt(s.g21Syp, 0) + " ل.س")));
            v.setTextViewText(R.id.wf_gold_meta, gMeta);

            PendingIntent pi = RatesWidget.openApp(c, 7004);
            if (pi != null) v.setOnClickPendingIntent(R.id.wf_root, pi);
            v.setOnClickPendingIntent(R.id.wf_refresh, RatesWidget.refreshIntent(c, RatesWidgetFull.class, 7104));
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
