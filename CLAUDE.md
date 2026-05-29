# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This is a two-app monorepo. Each app has its own dependency manager — they are deployed separately (Render + Vercel).

- `backend/` — FastAPI service (Python 3.12). Deployed to Render. Dependencies tracked in `backend/requirements.txt` and the `Procfile`.
- `frontend/` — Vite + React 18 SPA. Deployed to Vercel. Dependencies in `frontend/package.json`.
- `main.py` and `pyproject.toml` at the root are scaffolding from `uv init` and are **not** the running app. The real backend lives in `backend/`. Do not add backend code at the root.
- `pyproject.toml` and `backend/requirements.txt` are not kept in sync (e.g. they pin different `openai` versions). Treat `backend/requirements.txt` as authoritative for what actually runs in prod.

## Commands

### Backend (run from `backend/`)
```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000      # dev server, OpenAPI docs at /docs
python main.py                              # equivalent — main.py has __main__ runner
```
There is no test suite, linter, or formatter configured. Don't invent one unless asked.

### Frontend (run from `frontend/`)
```bash
npm install
npm run dev      # Vite on port 3000 (configured in vite.config.js, not the Vite default)
npm run build    # production build
```
No test runner or lint script is configured here either.

## Architecture

### Backend request flow
`backend/main.py` is the FastAPI entrypoint. It wires three modules together — keep this separation when adding features:

1. **`data_loader.py`** — single source of truth for products and stock. The CSV (`sales_data.csv`, 10 products keyed `P001`–`P010`) is loaded once via `@lru_cache` and `_load_csv()` is called in the FastAPI `lifespan` to warm the cache before the first request. `PRODUCT_CONFIG` (reorder points + supplier lead times) is hardcoded by product ID — adding a new product means adding both a CSV row and a `PRODUCT_CONFIG` entry.
   - `get_inventory()` **simulates** current stock from `avg_daily_sales × np.random.uniform(10, 90)` with a fixed seed (`42`). Stock levels are deterministic across restarts but are not real warehouse data — be aware of this when reasoning about the numbers shown in the UI.

2. **`forecaster.py`** — `forecast_demand(product_id, forecast_days)` returns history + prediction + summary. The model is a fixed ensemble: `0.4 × 14-day_moving_average + 0.6 × linear_regression`. Confidence band is `±1.5 × std(residuals)`. Trend is bucketed by regression slope (±0.05). The 90-day history window is hardcoded.

3. **`ai_alerts.py`** — `generate_alerts()` runs forecasting for every product, classifies severity (`_classify_severity` using `days_remaining` vs `lead_time`), then either calls Azure OpenAI (live mode) or fills a string template (demo mode). The branch is decided at call time by checking `AZURE_OPENAI_KEY` + `AZURE_OPENAI_ENDPOINT`. The `openai` SDK is imported lazily inside the live branch so the app boots without the package having to be configured. **Both branches must produce the same dict shape** — the frontend reads `ai_generated` to badge the UI but otherwise renders both identically.

The same severity logic is duplicated in `main.py::summary()` and `ai_alerts.py::_classify_severity`. If you change the thresholds, change both.

### Frontend
`frontend/src/App.jsx` is a single-file React app — three tabs (`Dashboard`, `Forecast`, `Alerts`) and all components live in this one file. Styling is inline objects keyed off a `T` design-tokens object at the top; there is no CSS framework and no CSS file. `api.js` is a thin `fetch` wrapper; the backend URL comes from `VITE_API_URL` (set in Vercel) and defaults to `http://localhost:8000`.

### CORS / cross-origin wiring
`backend/main.py` allows `localhost:3000`, `localhost:5173`, and whatever is in the `FRONTEND_URL` env var. When deploying, set `FRONTEND_URL` on Render to the Vercel URL — otherwise the deployed frontend cannot call the API.

### Demo mode
The app is designed to be fully functional without Azure credentials. When changing the alerts pipeline, preserve this: never make `AZURE_OPENAI_KEY` a hard requirement for the API to start or for `/api/alerts` to return data.

## Deployment

- **Backend → Render**: configured by `render.yaml` (root `rootDir: backend`, uses `requirements.txt` and the `Procfile`). Azure keys and `FRONTEND_URL` are set manually in the Render dashboard (`sync: false`).
- **Frontend → Vercel**: root directory set to `frontend/`. `vercel.json` rewrites all paths to `index.html` for SPA routing. `VITE_API_URL` must be set in Vercel to the Render backend URL.
