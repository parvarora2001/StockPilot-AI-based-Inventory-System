import logging
import warnings
from datetime import timedelta

import numpy as np
from statsmodels.tsa.holtwinters import ExponentialSmoothing

from data_loader import get_daily_sales

logger = logging.getLogger(__name__)


def _fit_holt_winters(sales: np.ndarray):
    """Additive Holt-Winters with weekly seasonality. Returns (forecast_fn, fitted) or (None, None)."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            model = ExponentialSmoothing(
                sales,
                seasonal="add",
                seasonal_periods=7,
                trend="add",
                initialization_method="estimated",
            ).fit(optimized=True)
        fitted = np.asarray(model.fittedvalues, dtype=float)
        return model.forecast, fitted
    except Exception as exc:
        logger.warning("Holt-Winters fit failed (%s) — falling back to moving average", exc)
        return None, None


def forecast_demand(product_id: str, forecast_days: int = 30) -> dict:
    """
    Returns history + forecast + summary. Uses Holt-Winters (level + trend + 7-day seasonality)
    with residual-based confidence intervals. Falls back to a 14-day moving average if HW
    fails to converge (rare — happens on near-constant series).

    Anomaly detection: any of the last 7 days with residual z-score > 2.5 flips `summary.anomaly`.
    """
    history_df = get_daily_sales(product_id, days=90)
    sales      = history_df["units_sold"].to_numpy(dtype=float)
    last_date  = history_df["date"].max()

    history_dates  = history_df["date"].dt.strftime("%Y-%m-%d").tolist()
    forecast_dates = [
        (last_date + timedelta(days=i + 1)).strftime("%Y-%m-%d")
        for i in range(forecast_days)
    ]

    forecast_fn, fitted = _fit_holt_winters(sales)

    if forecast_fn is not None:
        forecast = np.maximum(np.asarray(forecast_fn(forecast_days), dtype=float), 0)
        method   = "holt-winters"
    else:
        ma       = float(np.mean(sales[-14:]))
        forecast = np.full(forecast_days, ma)
        fitted   = np.full_like(sales, ma)
        method   = "moving-average-fallback"

    residuals = sales - fitted
    std       = float(np.std(residuals))
    lower     = np.maximum(forecast - 1.5 * std, 0)
    upper     = forecast + 1.5 * std

    # Trend direction — compare smoothed mean of last 14 days vs first 14 days.
    recent_mean = float(np.mean(fitted[-14:]))
    older_mean  = float(np.mean(fitted[:14]))
    if older_mean > 0:
        change = (recent_mean - older_mean) / older_mean
        trend  = "increasing" if change > 0.05 else "decreasing" if change < -0.05 else "stable"
    else:
        trend = "stable"

    # Anomaly: z-score on residuals, only looking at the last 7 days.
    if std > 0:
        recent_z      = np.abs(residuals[-7:] - float(np.mean(residuals))) / std
        anomaly       = bool(np.any(recent_z > 2.5))
        anomaly_score = float(np.max(recent_z))
    else:
        anomaly       = False
        anomaly_score = 0.0

    return {
        "product_id": product_id,
        "history": {
            "dates": history_dates,
            "sales": sales.tolist(),
        },
        "forecast": {
            "dates":       forecast_dates,
            "predicted":   [round(v, 1) for v in forecast.tolist()],
            "lower_bound": [round(v, 1) for v in lower.tolist()],
            "upper_bound": [round(v, 1) for v in upper.tolist()],
        },
        "summary": {
            "avg_forecast_daily":     round(float(np.mean(forecast)), 1),
            "trend":                  trend,
            "volatility":             round(std, 2),
            "total_forecasted_units": round(float(np.sum(forecast))),
            "method":                 method,
            "anomaly":                anomaly,
            "anomaly_score":          round(anomaly_score, 2),
        },
    }
