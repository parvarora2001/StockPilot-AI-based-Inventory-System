const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function get(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const fetchSummary     = ()             => get("/api/summary");
export const fetchInventory   = ()             => get("/api/inventory");
export const fetchForecast    = (id, days = 30) => get(`/api/forecast/${id}?days=${days}`);
export const fetchAlerts      = ()             => get("/api/alerts");
export const fetchDatasetInfo = ()             => get("/api/dataset-info");
