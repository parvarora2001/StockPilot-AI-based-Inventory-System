const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

// Render free-tier dynos cold-start in ~30s. 45s gives headroom.
const REQUEST_TIMEOUT_MS = 45000;

async function get(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, { signal: controller.signal });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Request failed: ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error("Backend took longer than 45 seconds to respond. Try refreshing in a moment.");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

export const fetchSummary     = ()             => get("/api/summary");
export const fetchInventory   = ()             => get("/api/inventory");
export const fetchForecast    = (id, days = 30) => get(`/api/forecast/${id}?days=${days}`);
export const fetchAlerts      = ()             => get("/api/alerts");
export const fetchDatasetInfo = ()             => get("/api/dataset-info");
