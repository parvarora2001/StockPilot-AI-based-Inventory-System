import os
import json
import logging

from data_loader import get_inventory
from forecaster import forecast_demand

logger = logging.getLogger(__name__)

# ── Severity classifier ───────────────────────────────────────────────────────

def _classify_severity(days_remaining: float, lead_time: int) -> str:
    if days_remaining <= lead_time:
        return "critical"
    elif days_remaining <= lead_time * 2:
        return "warning"
    elif days_remaining > 60:
        return "overstock"
    return "healthy"


# ── Demo mode: template messages when no Google API key is present ───────────

_DEMO_TEMPLATES = {
    "critical": (
        "{name} has only {days}d of stock left, which is below the {lead}d supplier lead time — "
        "a stockout is imminent with {trend} demand. "
        "Place an emergency order of {units} units today to avoid lost sales."
    ),
    "warning": (
        "{name} has {days}d of stock remaining, just twice the {lead}d lead time, "
        "with {trend} demand over the next 14 days. "
        "Reorder {units} units now to maintain a safe buffer before the next delivery window."
    ),
    "overstock": (
        "{name} currently holds {days}d worth of stock — well above the 60-day threshold. "
        "Pause replenishment orders and consider a promotional push to reduce carrying costs."
    ),
    "healthy": (
        "{name} has {days}d of stock on hand with {trend} demand — comfortably within "
        "operating parameters. "
        "No action required; review again at the next weekly inventory check."
    ),
}


def _demo_message(item: dict, days: float, severity: str, trend: str, units: int) -> str:
    return _DEMO_TEMPLATES[severity].format(
        name=item["name"],
        days=days,
        lead=item["lead_time_days"],
        trend=trend,
        units=units if units > 0 else "additional",
    )


# ── Live mode: Gemini via Google AI Studio ───────────────────────────────────
# All 10 products are sent in a single batched call. Gemini free tier limit is
# 5 req/min, so per-product calls (the previous design) hit 429 immediately.

def _batch_ai_messages(client, contexts: list[dict]) -> dict[str, str]:
    """One Gemini call → dict mapping product_id to a 2-sentence alert. Empty dict on failure."""
    products_block = "\n\n".join(
        f"Product ID: {c['id']}\n"
        f"Product: {c['name']}\n"
        f"Category: {c['category']}\n"
        f"Current Stock: {c['current_stock']} units\n"
        f"Days of Stock Remaining: {c['days']}\n"
        f"Supplier Lead Time: {c['lead_time']} days\n"
        f"Next 14-Day Forecasted Demand: {c['forecasted_14d']} units\n"
        f"Demand Trend: {c['trend']}\n"
        f"Risk Level: {c['severity'].upper()}"
        for c in contexts
    )
    prompt = f"""You are an AI inventory analyst. Write a 2-sentence alert for EACH product below.

{products_block}

Rules for every alert:
- Sentence 1: describe the situation using the exact numbers provided.
- Sentence 2: give a specific, actionable recommendation.
- Under 50 words. No jargon.

Return ONLY a JSON object mapping each Product ID to its alert text. Example:
{{"P001": "First product alert...", "P002": "Second product alert..."}}"""
    try:
        response = client.models.generate_content(
            model=os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
            contents=prompt,
            config={
                "max_output_tokens": 3000,
                "temperature": 0.3,
                "response_mime_type": "application/json",
                # Gemini 2.5 models have thinking on by default — those tokens
                # come out of max_output_tokens before the real response, so the
                # JSON gets truncated. Disable to keep the whole budget for output.
                "thinking_config": {"thinking_budget": 0},
            },
        )
        return json.loads(response.text or "{}")
    except Exception:
        logger.exception("Gemini batch call failed — falling back to demo templates")
        return {}


# ── Public entry point ────────────────────────────────────────────────────────

def generate_alerts() -> list[dict]:
    google_key = os.getenv("GOOGLE_API_KEY", "").strip()
    use_ai     = bool(google_key)

    client = None
    if use_ai:
        from google import genai
        client = genai.Client(api_key=google_key)
        logger.info("Generating alerts with Google Gemini (live mode, batched)")
    else:
        logger.info("GOOGLE_API_KEY not set — generating alerts in demo mode")

    inventory = get_inventory()

    # First pass: compute deterministic fields per product (no AI yet).
    rows: list[dict] = []
    for item in inventory:
        fc             = forecast_demand(item["id"], forecast_days=14)
        forecasted_14d = fc["summary"]["total_forecasted_units"]
        avg_daily      = fc["summary"]["avg_forecast_daily"]
        trend          = fc["summary"]["trend"]
        days_remaining = round(item["current_stock"] / avg_daily if avg_daily > 0 else 999, 1)
        severity       = _classify_severity(days_remaining, item["lead_time_days"])
        units_to_order = (
            max(0, int(forecasted_14d - item["current_stock"]))
            if severity in ("critical", "warning") else 0
        )
        rows.append({
            "item": item, "days_remaining": days_remaining, "severity": severity,
            "trend": trend, "forecasted_14d": forecasted_14d, "units_to_order": units_to_order,
        })

    # Second pass: ONE Gemini call for all 10 messages (or skip entirely in demo mode).
    ai_messages: dict[str, str] = {}
    if use_ai and client:
        ai_messages = _batch_ai_messages(client, [
            {
                "id": r["item"]["id"], "name": r["item"]["name"],
                "category": r["item"]["category"],
                "current_stock": r["item"]["current_stock"],
                "lead_time": r["item"]["lead_time_days"],
                "days": r["days_remaining"], "severity": r["severity"],
                "trend": r["trend"], "forecasted_14d": r["forecasted_14d"],
            }
            for r in rows
        ])

    # Assemble final alerts. If Gemini didn't return a message for some product, fall back to demo template.
    alerts: list[dict] = []
    for r in rows:
        item = r["item"]
        message = ai_messages.get(item["id"]) or _demo_message(
            item, r["days_remaining"], r["severity"], r["trend"], r["units_to_order"]
        )
        alerts.append({
            "product_id":     item["id"],
            "product_name":   item["name"],
            "category":       item["category"],
            "severity":       r["severity"],
            "current_stock":  item["current_stock"],
            "days_remaining": r["days_remaining"],
            "trend":          r["trend"],
            "units_to_order": r["units_to_order"],
            "message":        message,
            "ai_generated":   bool(ai_messages.get(item["id"])),
        })

    order = {"critical": 0, "warning": 1, "overstock": 2, "healthy": 3}
    alerts.sort(key=lambda x: order[x["severity"]])
    return alerts
