import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from data_loader import get_inventory, get_all_products, get_dataset_info, _load_csv
from forecaster import forecast_demand
from ai_alerts import generate_alerts

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s – %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Starting StockPilot — warming CSV cache…")
    _load_csv()
    logger.info("Cache ready. Server is live.")
    yield


app = FastAPI(
    title="StockPilot API",
    description="Smart inventory forecasting powered by ML + Gemini",
    version="1.0.0",
    lifespan=lifespan,
)

_allowed_origins = [
    "http://localhost:3000",
    "http://localhost:5173",
]
if frontend_url := os.getenv("FRONTEND_URL", "").strip():
    _allowed_origins.append(frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}


@app.get("/", tags=["meta"])
def root():
    return {"status": "running", "docs": "/docs"}


@app.get("/api/dataset-info", tags=["data"])
def dataset_info():
    return get_dataset_info()


@app.get("/api/inventory", tags=["data"])
def inventory():
    return {"data": get_inventory()}


@app.get("/api/summary", tags=["data"])
def summary():
    items = get_inventory()
    counts = {"critical": 0, "warning": 0, "overstock": 0, "healthy": 0}
    for item in items:
        d, lt = item["days_of_stock"], item["lead_time_days"]
        if d <= lt:
            counts["critical"] += 1
        elif d <= lt * 2:
            counts["warning"] += 1
        elif d > 60:
            counts["overstock"] += 1
        else:
            counts["healthy"] += 1

    return {
        "total_products": len(items),
        "total_units_in_stock": sum(i["current_stock"] for i in items),
        **counts,
    }


@app.get("/api/forecast/{product_id}", tags=["ml"])
def forecast(product_id: str, days: int = 30):
    valid_ids = {p["id"] for p in get_all_products()}
    if product_id not in valid_ids:
        raise HTTPException(404, f"Product '{product_id}' not found.")
    if not 7 <= days <= 90:
        raise HTTPException(400, "days must be between 7 and 90.")
    return forecast_demand(product_id, forecast_days=days)


@app.get("/api/alerts", tags=["ai"])
def alerts():
    try:
        result = generate_alerts()
        return {"data": result}
    except Exception as exc:
        logger.exception("Alert generation failed")
        raise HTTPException(500, f"Alert generation failed: {exc}") from exc


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
