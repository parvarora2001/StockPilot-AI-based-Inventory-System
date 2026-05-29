import os
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


# ── Demo mode: template messages when no Azure key is present ─────────────────

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


# ── Live mode: GPT-4o via Azure OpenAI ───────────────────────────────────────

def _ai_message(client, item: dict, days: float, severity: str, trend: str,
                forecasted_14d: int, units: int) -> str:
    prompt = f"""You are an AI inventory analyst. Write a 2-sentence alert for a retail store manager.

Product: {item['name']}
Category: {item['category']}
Current Stock: {item['current_stock']} units
Days of Stock Remaining: {days} days
Supplier Lead Time: {item['lead_time_days']} days
Next 14-Day Forecasted Demand: {forecasted_14d} units
Demand Trend: {trend}
Risk Level: {severity.upper()}

Rules:
- Sentence 1: Describe the situation using the exact numbers provided.
- Sentence 2: Give a specific, actionable recommendation.
- Keep it under 50 words total. No jargon.
"""
    response = client.chat.completions.create(
        model=os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o"),
        messages=[{"role": "user", "content": prompt}],
        max_tokens=100,
        temperature=0.3,
    )
    return response.choices[0].message.content.strip()


# ── Public entry point ────────────────────────────────────────────────────────

def generate_alerts() -> list[dict]:
    azure_key      = os.getenv("AZURE_OPENAI_KEY", "").strip()
    azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip()
    use_ai         = bool(azure_key and azure_endpoint)

    client = None
    if use_ai:
        from openai import AzureOpenAI
        client = AzureOpenAI(
            api_key=azure_key,
            azure_endpoint=azure_endpoint,
            api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-08-01-preview"),
        )
        logger.info("Generating alerts with Azure OpenAI (live mode)")
    else:
        logger.info("AZURE_OPENAI_KEY not set — generating alerts in demo mode")

    inventory = get_inventory()
    alerts: list[dict] = []

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

        if use_ai and client:
            message = _ai_message(client, item, days_remaining, severity, trend,
                                  forecasted_14d, units_to_order)
        else:
            message = _demo_message(item, days_remaining, severity, trend, units_to_order)

        alerts.append({
            "product_id":     item["id"],
            "product_name":   item["name"],
            "category":       item["category"],
            "severity":       severity,
            "current_stock":  item["current_stock"],
            "days_remaining": days_remaining,
            "trend":          trend,
            "units_to_order": units_to_order,
            "message":        message,
            "ai_generated":   use_ai,
        })

    order = {"critical": 0, "warning": 1, "overstock": 2, "healthy": 3}
    alerts.sort(key=lambda x: order[x["severity"]])
    return alerts
