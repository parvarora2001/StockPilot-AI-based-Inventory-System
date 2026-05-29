import numpy as np
from sklearn.linear_model import LinearRegression
from datetime import timedelta
from data_loader import get_daily_sales


def forecast_demand(product_id: str, forecast_days: int = 30) -> dict:
    """
    Returns a dict with:
      - history:  past 90 days of actual sales (for the chart)
      - forecast: next N days of predicted sales + confidence band
      - summary:  key numbers (avg daily, trend direction, total units)
    """

    # ── 1. Load 90 days of real sales history ────────────────────────────────
    history_df = get_daily_sales(product_id, days=90)
    sales      = history_df["units_sold"].values          # numpy array of daily sales
    last_date  = history_df["date"].max()                 # last date we have data for

    # Date labels for the chart
    history_dates  = history_df["date"].dt.strftime("%Y-%m-%d").tolist()
    forecast_dates = [
        (last_date + timedelta(days=i + 1)).strftime("%Y-%m-%d")
        for i in range(forecast_days)
    ]

    # ── 2. Moving Average ─────────────────────────────────────────────────────
    ma_value = float(np.mean(sales[-14:]))          # average of last 14 days
    ma_forecast = np.full(forecast_days, ma_value)  # flat line at that average

    # ── 3. Linear Regression ──────────────────────────────────────────────────
    X = np.arange(len(sales)).reshape(-1, 1)        # [0,1,2,...,89] as input
    model = LinearRegression().fit(X, sales)

    future_X    = np.arange(len(sales), len(sales) + forecast_days).reshape(-1, 1)
    lr_forecast = np.maximum(model.predict(future_X), 0)   # can't be negative

    # ── 4. Ensemble: blend the two forecasts ──────────────────────────────────
    forecast = 0.4 * ma_forecast + 0.6 * lr_forecast

    # ── 5. Confidence interval ────────────────────────────────────────────────
    residuals    = sales - model.predict(X)     # how wrong was the model on history?
    std          = float(np.std(residuals))     # measure of that error
    lower        = np.maximum(forecast - 1.5 * std, 0)
    upper        = forecast + 1.5 * std

    # ── 6. Trend direction ────────────────────────────────────────────────────
    slope = float(model.coef_[0])
    if slope > 0.05:
        trend = "increasing"
    elif slope < -0.05:
        trend = "decreasing"
    else:
        trend = "stable"

    return {
        "product_id": product_id,

        # Past data — used to draw the left side of the chart
        "history": {
            "dates": history_dates,
            "sales": sales.tolist(),
        },

        # Future predictions — used to draw the right side of the chart
        "forecast": {
            "dates":       forecast_dates,
            "predicted":   [round(v, 1) for v in forecast.tolist()],
            "lower_bound": [round(v, 1) for v in lower.tolist()],
            "upper_bound": [round(v, 1) for v in upper.tolist()],
        },

        # Summary stats shown above the chart
        "summary": {
            "avg_forecast_daily":    round(float(np.mean(forecast)), 1),
            "trend":                 trend,
            "volatility":            round(std, 2),
            "total_forecasted_units": round(float(np.sum(forecast))),
        },
    }
