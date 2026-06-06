# StockPilot

A full-stack inventory management dashboard with ML-powered demand forecasting and AI-generated alerts.

**Live demo →** https://stock-pilot-ai-based-inventory-syst.vercel.app

---

## Features

- **Real-time inventory dashboard** — stock levels, days-of-stock, and reorder status for 10 products across 4 risk tiers (Critical / Warning / Overstock / Healthy)
- **ML demand forecasting** — Holt-Winters exponential smoothing (level + trend + 7-day seasonality) with residual-based confidence bands and anomaly detection; selectable horizon of 14, 30, 60, or 90 days
- **AI alerts** — per-product plain-English recommendations powered by Google Gemini; falls back to template-based alerts in demo mode so the app is fully functional without an API key
- **Dark-mode UI** — built with React + Recharts, no CSS framework

## Tech stack

| Layer     | Technology |
|-----------|-----------|
| Frontend  | React 18, Vite, Recharts |
| Backend   | Python 3.12, FastAPI, Uvicorn |
| ML        | scikit-learn (LinearRegression), NumPy, pandas |
| AI        | Google Gemini (`gemini-2.0-flash`) |
| Deploy    | Vercel (frontend) + Render (backend) |

---

## Running locally

### Prerequisites
- Python 3.12+ and [uv](https://docs.astral.sh/uv/) (or pip)
- Node.js 18+

### 1 — Backend

```bash
cd backend
cp .env.example .env          # fill in your Google AI Studio key (optional)
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

API docs available at `http://localhost:8000/docs`

### 2 — Frontend

```bash
cd frontend
npm install
npm run dev                   # starts on http://localhost:3000
```

> The app works without a Google API key — the Alerts tab uses template-based messages in that case.

---

## Deployment

### Backend → Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New Web Service** → connect your repo
3. Set **Root Directory** to `backend`
4. Render auto-detects the `Procfile`; no build command needed beyond `pip install -r requirements.txt`
5. Add environment variables in the Render dashboard (copy from `.env.example`)
6. Copy the deployed URL (e.g. `https://stockpilot.onrender.com`)

### Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project** → import your repo
2. Set **Root Directory** to `frontend`
3. Add environment variable: `VITE_API_URL` = your Render URL from above
4. Deploy — Vercel auto-detects Vite

### Cross-origin wiring

Back in Render, set the `FRONTEND_URL` env var to your Vercel URL so CORS is allowed.

---

## Project structure

```
stockpilot/
├── backend/
│   ├── main.py          # FastAPI app, routes, CORS, lifespan
│   ├── data_loader.py   # CSV ingestion, inventory simulation
│   ├── forecaster.py    # ML ensemble (LinearRegression + moving average)
│   ├── ai_alerts.py     # Gemini alerts with demo fallback
│   ├── sales_data.csv   # Synthetic sales history (10 products)
│   ├── requirements.txt
│   ├── Procfile         # Render start command
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx      # Dashboard, Forecast, Alerts tabs
│   │   └── api.js       # Fetch helpers
│   ├── vercel.json      # SPA rewrite rule
│   └── package.json
└── render.yaml          # Render service config
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/inventory` | All products with stock levels |
| GET | `/api/summary` | KPI counts (critical/warning/overstock/healthy) |
| GET | `/api/dataset-info` | CSV metadata |
| GET | `/api/forecast/{id}?days=30` | ML demand forecast (7–90 days) |
| GET | `/api/alerts` | AI-generated per-product alerts |
