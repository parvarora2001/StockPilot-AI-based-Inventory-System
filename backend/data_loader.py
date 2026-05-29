import pandas as pd
import numpy as np
from pathlib import Path
from functools import lru_cache

# Path to the CSV file (same folder as this script)
CSV_PATH = Path(__file__).parent / "sales_data.csv"

# How much stock to reorder, and how many days the supplier takes to deliver
PRODUCT_CONFIG = {
    "P001": {"reorder_point": 50,  "lead_time_days": 7},
    "P002": {"reorder_point": 30,  "lead_time_days": 14},
    "P003": {"reorder_point": 100, "lead_time_days": 5},
    "P004": {"reorder_point": 20,  "lead_time_days": 10},
    "P005": {"reorder_point": 40,  "lead_time_days": 6},
    "P006": {"reorder_point": 60,  "lead_time_days": 8},
    "P007": {"reorder_point": 35,  "lead_time_days": 9},
    "P008": {"reorder_point": 80,  "lead_time_days": 4},
    "P009": {"reorder_point": 45,  "lead_time_days": 7},
    "P010": {"reorder_point": 55,  "lead_time_days": 6},
}


@lru_cache(maxsize=1)
def _load_csv() -> pd.DataFrame:
    """
    Load the CSV once and keep it in memory.
    @lru_cache means this function only runs once — subsequent calls
    return the cached result instantly.
    """
    df = pd.read_csv(CSV_PATH, parse_dates=["date"])
    return df


def get_daily_sales(product_id: str, days: int = 90) -> pd.DataFrame:
    """
    Return a DataFrame of daily sales for one product over the last N days.

    Example output:
        date         units_sold
        2024-06-01   12
        2024-06-02   9
        ...

    Missing days (e.g. Sundays) are filled with 0.
    """
    df = _load_csv()
    product_df = df[df["product_id"] == product_id].copy()

    if product_df.empty:
        raise ValueError(f"Product '{product_id}' not found in sales_data.csv")

    # Take only the last N days of data
    last_date = product_df["date"].max()
    start_date = last_date - pd.Timedelta(days=days - 1)
    product_df = product_df[product_df["date"] >= start_date]

    # Aggregate by day (sum units sold) and fill any missing days with 0
    daily = (
        product_df
        .groupby("date")["units_sold"]
        .sum()
        .reindex(pd.date_range(start_date, last_date, freq="D"), fill_value=0)
        .reset_index()
    )
    daily.columns = ["date", "units_sold"]
    return daily


def get_all_products() -> list[dict]:
    """Return a list of all unique products from the CSV."""
    df = _load_csv()
    products = []
    for pid, group in df.groupby("product_id"):
        cfg = PRODUCT_CONFIG.get(pid, {"reorder_point": 30, "lead_time_days": 7})
        products.append({
            "id": pid,
            "name": group["product_name"].iloc[0],
            "category": group["category"].iloc[0],
            "unit_price": group["unit_price"].iloc[0],
            "reorder_point": cfg["reorder_point"],
            "lead_time_days": cfg["lead_time_days"],
        })
    return products


def get_inventory() -> list[dict]:
    """
    Return current stock levels for all products.

    Current stock is SIMULATED by:
      avg_daily_sales × random_multiplier (14 to 90 days worth of stock)

    In a real app this would query a warehouse database.
    """
    np.random.seed(42)  # fixed seed so numbers don't change on every restart
    inventory = []

    for product in get_all_products():
        # Get last 30 days of sales to estimate current demand rate
        daily_30 = get_daily_sales(product["id"], days=30)
        avg_daily = float(daily_30["units_sold"].mean())

        # Simulate how much stock is currently sitting in the warehouse
        multiplier = np.random.uniform(10, 90)
        current_stock = max(1, int(avg_daily * multiplier))

        # days_of_stock = how many days before we run out at current rate
        days_of_stock = round(current_stock / avg_daily, 1) if avg_daily > 0 else 999

        inventory.append({
            **product,
            "current_stock": current_stock,
            "avg_daily_sales": round(avg_daily, 1),
            "days_of_stock": days_of_stock,
        })

    return inventory


def get_dataset_info() -> dict:
    """Return high-level facts about the dataset — shown on the dashboard."""
    df = _load_csv()
    return {
        "total_rows": len(df),
        "date_from": df["date"].min().strftime("%Y-%m-%d"),
        "date_to": df["date"].max().strftime("%Y-%m-%d"),
        "total_products": df["product_id"].nunique(),
        "total_revenue": round(float(df["revenue"].sum()), 2),
    }
