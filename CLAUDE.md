# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Two-app monorepo. Each app has its own dependency manager and is deployed separately.

- `backend/` — FastAPI service (Python 3.12). Deployed to Render. Dependencies: `backend/requirements.txt` + `Procfile`.
- `frontend/` — Vite + React 18 SPA. Deployed to Vercel. Dependencies: `frontend/package.json`.
- Root `main.py` and `pyproject.toml` are leftover `uv init` scaffolding — **not the running app**. Add backend code in `backend/`, never at the root.
- `pyproject.toml` and `backend/requirements.txt` may drift on dependency pins. `backend/requirements.txt` is authoritative for prod (it's what Render installs).

## Commands

### Backend (run from `backend/`)
```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000      # OpenAPI docs at /docs
```
No test suite, linter, or formatter is configured. Don't introduce one unless asked.

### Frontend (run from `frontend/`)
```bash
npm install
npm run dev      # Vite on port 3000 (set in vite.config.js, not the Vite default of 5173)
npm run build
```
No test runner or lint script here either.

## Architecture

`backend/main.py` is the FastAPI entrypoint. It wires three modules — preserve this separation when adding features.

1. **`data_loader.py`** — single source of truth for products and stock. The CSV (`sales_data.csv`, 10 products `P001`–`P010`) is loaded once via `@lru_cache` and warmed in the FastAPI `lifespan` before the first request. `PRODUCT_CONFIG` (reorder points + lead times) is hardcoded by product ID — adding a product means adding both a CSV row and a `PRODUCT_CONFIG` entry.
   - `get_inventory()` **simulates** current stock as `avg_daily_sales × np.random.uniform(10, 90)` with a fixed seed (`42`). Deterministic across restarts but **not** real warehouse data. Be aware of this when reasoning about the numbers shown in the UI.

2. **`forecaster.py`** — `forecast_demand(product_id, forecast_days)` returns history + prediction + summary. Fixed ensemble: `0.4 × 14-day_moving_average + 0.6 × linear_regression`. Confidence band is `±1.5 × std(residuals)`. Trend is bucketed by regression slope (±0.05). 90-day history window is hardcoded.

3. **`ai_alerts.py`** — `generate_alerts()` runs forecasting for every product, classifies severity, then either calls Google Gemini (live mode) or fills a string template (demo mode). The branch is decided at call time by checking `GOOGLE_API_KEY` in `ai_alerts.py`. The `google-genai` SDK is imported lazily inside the live branch so the app boots without the package being configured. Model defaults to `gemini-2.0-flash` and can be overridden with `GEMINI_MODEL`. **Both branches must produce the same dict shape** — the frontend reads `ai_generated` to badge the UI but otherwise renders both identically.

The same severity logic is duplicated in `main.py::summary()` and `ai_alerts.py::_classify_severity`. If you change thresholds, change both.

### Demo mode is a contract
The app must remain fully functional without a Google API key. Never make `GOOGLE_API_KEY` a hard requirement for the API to start or for `/api/alerts` to return data.

### Frontend
`frontend/src/App.jsx` is a single-file React app — three tabs (`Dashboard`, `Forecast`, `Alerts`) and every component lives in this one file. Styling is inline objects keyed off a `T` design-tokens object at the top; no CSS framework, no CSS file. `api.js` is a thin `fetch` wrapper; backend URL comes from `VITE_API_URL` (set in Vercel) and defaults to `http://localhost:8000`.

### CORS
`backend/main.py` allows `localhost:3000`, `localhost:5173`, and whatever is in the `FRONTEND_URL` env var. When deploying, set `FRONTEND_URL` on Render to the Vercel URL — otherwise the deployed frontend can't call the API.

## Common gotchas

- **`.env` is loaded, `.env.example` is not.** `backend/main.py:9` calls `load_dotenv()` with no args, which reads `backend/.env`. `.env.example` is a committed template only.
- **Empty `GOOGLE_API_KEY` triggers demo mode.** The check in `ai_alerts.py` is `bool(google_key)` after `.strip()`. To force demo mode, blank out the value (don't just comment it).
- **Gemini free tier (AI Studio).** Get a key at https://aistudio.google.com/apikey. Free quota on `gemini-2.0-flash` is ~15 req/min, ~1,500/day — well above portfolio usage. No card required.
- **Render free tier sleeps after 15 min idle.** First request after sleep takes ~30s to wake the dyno. If a deployed `/api/alerts` call appears to hang, that's why — not a bug.
- **CORS troubleshooting.** `backend/main.py:42` appends `FRONTEND_URL` to the allowed origins list. The match is exact string equality — a trailing slash, missing `https://`, or stray newline silently breaks CORS. Verify with `curl -D - https://<backend>/api/summary -H "Origin: https://<frontend>"` and look for `access-control-allow-origin` in the response.

## Deployment

- **Backend → Render**: configured by `render.yaml` (`rootDir: backend`, uses `requirements.txt` and `Procfile`). `GOOGLE_API_KEY` and `FRONTEND_URL` set manually in the Render dashboard (`sync: false`).
- **Frontend → Vercel**: root directory set to `frontend/`. `vercel.json` rewrites all paths to `index.html` for SPA routing. `VITE_API_URL` must be set in Vercel to the Render backend URL (no trailing slash).
- **Order matters**: deploy backend first → get URL → set `VITE_API_URL` in Vercel → deploy frontend → set `FRONTEND_URL` in Render → backend auto-redeploys.
