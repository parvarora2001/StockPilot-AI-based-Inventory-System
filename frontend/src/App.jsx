import { useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  fetchSummary, fetchInventory,
  fetchForecast, fetchAlerts, fetchDatasetInfo,
} from "./api";

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  bg:        "#09101f",
  card:      "#111827",
  cardHover: "#162032",
  border:    "#1e2d40",
  amber:     "#f59e0b",
  red:       "#ef4444",
  green:     "#10b981",
  blue:      "#3b82f6",
  purple:    "#8b5cf6",
  text:      "#e2e8f0",
  muted:     "#64748b",
  dim:       "#94a3b8",
};

const SEVERITY = {
  critical:  { color: T.red,   bg: "#7f1d1d33", label: "CRITICAL",  icon: "⚠" },
  warning:   { color: T.amber, bg: "#92400e33", label: "WARNING",   icon: "◈" },
  overstock: { color: T.blue,  bg: "#1e3a5f33", label: "OVERSTOCK", icon: "↑" },
  healthy:   { color: T.green, bg: "#064e3b33", label: "HEALTHY",   icon: "✓" },
};

const FORECAST_DAY_OPTIONS = [14, 30, 60, 90];


// ── Reusable components ───────────────────────────────────────────────────────

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.border}`,
      borderRadius: 12, padding: "20px 24px", ...style,
    }}>
      {children}
    </div>
  );
}

function KpiCard({ label, value, color, icon }) {
  return (
    <Card style={{ borderLeft: `3px solid ${color}`, display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{
        width: 42, height: 42, borderRadius: 10,
        background: color + "22", display: "flex",
        alignItems: "center", justifyContent: "center",
        fontSize: 20, color,
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: 28, fontWeight: 800, color, fontFamily: "'Syne',sans-serif" }}>
          {value}
        </div>
        <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>
          {label}
        </div>
      </div>
    </Card>
  );
}

function Badge({ severity }) {
  const s = SEVERITY[severity];
  return (
    <span style={{
      fontSize: 10, padding: "2px 8px", borderRadius: 4,
      background: s.bg, color: s.color, fontWeight: 700,
      letterSpacing: "0.06em",
    }}>{s.label}</span>
  );
}

function Chip({ label, color = T.muted, bg = T.border + "55" }) {
  return (
    <span style={{
      fontSize: 10, padding: "2px 8px", borderRadius: 4,
      background: bg, color, fontWeight: 700,
      letterSpacing: "0.06em",
    }}>{label}</span>
  );
}

function ErrorBanner({ message }) {
  return (
    <div style={{
      background: "#7f1d1d33", border: `1px solid ${T.red}`,
      borderRadius: 10, padding: "12px 18px",
      color: T.red, fontSize: 13, marginBottom: 20,
    }}>
      ⚠ {message}
    </div>
  );
}

function WakingBanner() {
  return (
    <div style={{
      background: T.amber + "18", border: `1px solid ${T.amber}`,
      borderRadius: 10, padding: "12px 18px",
      color: T.amber, fontSize: 13, marginBottom: 20,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <span style={{ fontSize: 16 }}>⏳</span>
      <div>
        <b>Backend is waking up from idle.</b>{" "}
        <span style={{ color: T.dim }}>First load takes up to 30 seconds on the free Render tier — subsequent requests are instant.</span>
      </div>
    </div>
  );
}

function Skeleton({ height = 80, style = {} }) {
  return (
    <div style={{
      background: `linear-gradient(90deg, ${T.card} 25%, ${T.cardHover} 50%, ${T.card} 75%)`,
      backgroundSize: "200% 100%",
      animation: "shimmer 1.4s infinite",
      borderRadius: 12, height,
      border: `1px solid ${T.border}`,
      ...style,
    }} />
  );
}

const globalStyles = `
  @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
  @media (max-width: 768px) {
    .sp-container  { padding: 16px !important; max-width: 100% !important; }
    .sp-header     { padding: 0 16px !important; }
    .sp-kpi-grid   { grid-template-columns: repeat(2, 1fr) !important; }
    .sp-forecast-grid { grid-template-columns: 1fr !important; }
    .sp-product-list { max-height: 220px; overflow-y: auto; }
  }
  @media (max-width: 480px) {
    .sp-kpi-grid    { grid-template-columns: 1fr !important; }
    .sp-header-nav button { padding: 6px 10px !important; font-size: 12px !important; }
  }
`;
const shimmerStyle = globalStyles;


// ── Dashboard tab ─────────────────────────────────────────────────────────────

function DashboardTab({ summary, inventory, datasetInfo, onViewForecast, initialLoading }) {
  function daysColor(item) {
    const d = item.days_of_stock, lt = item.lead_time_days;
    if (d <= lt)     return T.red;
    if (d <= lt * 2) return T.amber;
    if (d > 60)      return T.blue;
    return T.green;
  }

  if (initialLoading) {
    return (
      <>
        <style>{shimmerStyle}</style>
        <Skeleton height={46} style={{ marginBottom: 24 }} />
        <div className="sp-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24 }}>
          {[0, 1, 2, 3].map(i => <Skeleton key={i} height={82} />)}
        </div>
        <Skeleton height={380} style={{ marginBottom: 20 }} />
        <Skeleton height={230} />
      </>
    );
  }

  return (
    <>
      <style>{shimmerStyle}</style>

      {datasetInfo && (
        <div style={{
          background: T.card, border: `1px solid ${T.border}`,
          borderRadius: 10, padding: "10px 20px",
          display: "flex", flexWrap: "wrap", gap: 24, marginBottom: 24, fontSize: 13,
        }}>
          <span style={{ color: T.muted }}>
            📂 Dataset: <b style={{ color: T.dim }}>{datasetInfo.total_rows.toLocaleString()} rows</b>
          </span>
          <span style={{ color: T.muted }}>
            📅 <b style={{ color: T.dim }}>{datasetInfo.date_from}</b> → <b style={{ color: T.dim }}>{datasetInfo.date_to}</b>
          </span>
          <span style={{ color: T.muted }}>
            💰 Revenue: <b style={{ color: T.green }}>${datasetInfo.total_revenue.toLocaleString()}</b>
          </span>
          <span style={{ color: T.muted }}>
            📦 Products: <b style={{ color: T.dim }}>{datasetInfo.total_products}</b>
          </span>
        </div>
      )}

      {summary && (
        <div className="sp-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24 }}>
          <KpiCard label="Critical"  value={summary.critical}  color={T.red}   icon="⚠" />
          <KpiCard label="Warning"   value={summary.warning}   color={T.amber} icon="◈" />
          <KpiCard label="Overstock" value={summary.overstock} color={T.blue}  icon="↑" />
          <KpiCard label="Healthy"   value={summary.healthy}   color={T.green} icon="✓" />
        </div>
      )}

      <Card style={{ marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 18px", fontSize: 15, color: T.text, fontFamily: "'Syne',sans-serif" }}>
          Inventory Overview
        </h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 680 }}>
            <thead>
              <tr>
                {["Product", "Category", "Price", "In Stock", "Avg Daily Sales", "Days Left", "Status", ""].map(h => (
                  <th key={h} style={{
                    padding: "7px 12px", textAlign: "left",
                    color: T.muted, fontWeight: 600, fontSize: 11,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                    borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inventory.map(item => (
                <tr key={item.id}
                  style={{ borderBottom: `1px solid ${T.border}22` }}
                  onMouseEnter={e => e.currentTarget.style.background = T.cardHover}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <td style={{ padding: "11px 12px", color: T.text, fontWeight: 600 }}>{item.name}</td>
                  <td style={{ padding: "11px 12px", color: T.dim }}>{item.category}</td>
                  <td style={{ padding: "11px 12px", color: T.dim }}>${item.unit_price}</td>
                  <td style={{ padding: "11px 12px", color: T.text, fontFamily: "'Syne',sans-serif", fontWeight: 700 }}>
                    {item.current_stock.toLocaleString()}
                  </td>
                  <td style={{ padding: "11px 12px", color: T.dim }}>{item.avg_daily_sales}/day</td>
                  <td style={{ padding: "11px 12px" }}>
                    <span style={{ color: daysColor(item), fontWeight: 700, fontFamily: "'Syne',sans-serif" }}>
                      {item.days_of_stock}d
                    </span>
                  </td>
                  <td style={{ padding: "11px 12px" }}>
                    <Badge severity={
                      item.days_of_stock <= item.lead_time_days ? "critical"
                      : item.days_of_stock <= item.lead_time_days * 2 ? "warning"
                      : item.days_of_stock > 60 ? "overstock"
                      : "healthy"
                    } />
                  </td>
                  <td style={{ padding: "11px 12px" }}>
                    <button onClick={() => onViewForecast(item.id)} style={{
                      background: "transparent", border: `1px solid ${T.border}`,
                      color: T.muted, padding: "4px 10px", borderRadius: 6,
                      cursor: "pointer", fontSize: 11, fontWeight: 600,
                      transition: "all 0.12s",
                    }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = T.amber; e.currentTarget.style.color = T.amber; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.muted; }}
                    >
                      Forecast →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {inventory.length > 0 && (
        <Card>
          <h2 style={{ margin: "0 0 18px", fontSize: 15, color: T.text, fontFamily: "'Syne',sans-serif" }}>
            Stock vs Reorder Point
          </h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={inventory} margin={{ left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
              <XAxis dataKey="id" tick={{ fill: T.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: T.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text }}
                labelFormatter={id => inventory.find(i => i.id === id)?.name || id}
              />
              <Legend wrapperStyle={{ color: T.muted, fontSize: 12 }} />
              <Bar dataKey="current_stock" name="Current Stock"  fill={T.blue}          radius={[4, 4, 0, 0]} />
              <Bar dataKey="reorder_point" name="Reorder Point"  fill={T.amber + "88"}  radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
    </>
  );
}


// ── Forecast tab ──────────────────────────────────────────────────────────────

function ForecastTab({ inventory, selectedId, onSelect, onChangeDays, forecastDays, forecast, loading }) {
  const product = inventory.find(i => i.id === selectedId);

  const chartData = forecast ? [
    ...forecast.history.dates.slice(-30).map((d, i) => ({
      date:   d.slice(5),
      actual: forecast.history.sales[forecast.history.sales.length - 30 + i],
    })),
    ...forecast.forecast.dates.map((d, i) => ({
      date:      d.slice(5),
      predicted: forecast.forecast.predicted[i],
      lower:     forecast.forecast.lower_bound[i],
      upper:     forecast.forecast.upper_bound[i],
    })),
  ] : [];

  return (
    <div className="sp-forecast-grid" style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20 }}>
      {/* Product list */}
      <Card style={{ padding: "16px" }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>
          Select Product
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {inventory.map(item => (
            <button key={item.id} onClick={() => onSelect(item.id)} style={{
              background: item.id === selectedId ? T.amber + "18" : "transparent",
              border: `1px solid ${item.id === selectedId ? T.amber : T.border}`,
              borderRadius: 8, padding: "10px 14px", cursor: "pointer",
              textAlign: "left", color: item.id === selectedId ? T.amber : T.dim,
              fontSize: 13, transition: "all 0.12s",
            }}>
              <div style={{ fontWeight: 600, marginBottom: 2, color: item.id === selectedId ? T.amber : T.text }}>
                {item.name}
              </div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>
                {item.current_stock.toLocaleString()} units · {item.days_of_stock}d left
              </div>
            </button>
          ))}
        </div>
      </Card>

      {/* Chart panel */}
      <Card>
        {!selectedId && (
          <div style={{ height: 340, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: T.muted }}>
            <div style={{ fontSize: 36 }}>📈</div>
            <div style={{ fontSize: 14 }}>Select a product to see its demand forecast</div>
          </div>
        )}

        {selectedId && loading && (
          <>
            <style>{shimmerStyle}</style>
            <Skeleton height={36} style={{ marginBottom: 20, width: "40%" }} />
            <Skeleton height={300} />
          </>
        )}

        {!loading && forecast && product && (
          <>
            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontFamily: "'Syne',sans-serif", fontSize: 17, color: T.text }}>
                  {product.name}
                </h2>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: T.muted }}>
                  {forecastDays}-day demand forecast with confidence interval
                </p>
              </div>
              <div style={{ display: "flex", gap: 20, textAlign: "right", flexWrap: "wrap" }}>
                {[
                  ["Avg Daily", `${forecast.summary.avg_forecast_daily} units`],
                  ["Trend",     forecast.summary.trend],
                  [`${forecastDays}d Total`, `${forecast.summary.total_forecasted_units} units`],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div style={{ fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: T.amber, fontFamily: "'Syne',sans-serif", textTransform: "capitalize" }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Day range selector */}
            <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
              {FORECAST_DAY_OPTIONS.map(d => (
                <button key={d} onClick={() => onChangeDays(d)} style={{
                  background: d === forecastDays ? T.amber + "22" : "transparent",
                  border: `1px solid ${d === forecastDays ? T.amber : T.border}`,
                  color: d === forecastDays ? T.amber : T.muted,
                  padding: "4px 12px", borderRadius: 6, cursor: "pointer",
                  fontSize: 12, fontWeight: 600, transition: "all 0.12s",
                }}>{d}d</button>
              ))}
            </div>

            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={T.blue}  stopOpacity={0.3} />
                    <stop offset="95%" stopColor={T.blue}  stopOpacity={0}   />
                  </linearGradient>
                  <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={T.amber} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={T.amber} stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: T.muted, fontSize: 10 }} axisLine={false} tickLine={false} interval={Math.ceil(chartData.length / 8)} />
                <YAxis tick={{ fill: T.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
                <Tooltip contentStyle={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text }} />
                <Legend wrapperStyle={{ color: T.muted, fontSize: 12 }} />
                <Area dataKey="actual"    name="Actual Sales" stroke={T.blue}  fill="url(#actualGrad)"   strokeWidth={2} dot={false} connectNulls />
                <Area dataKey="upper"     name="Upper CI"     stroke="none"    fill={T.amber + "22"}     dot={false} connectNulls />
                <Area dataKey="lower"     name="Lower CI"     stroke="none"    fill={T.bg}               dot={false} connectNulls />
                <Area dataKey="predicted" name="Forecast"     stroke={T.amber} fill="url(#forecastGrad)" strokeWidth={2} dot={false} connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          </>
        )}
      </Card>
    </div>
  );
}


// ── AI Alerts tab ─────────────────────────────────────────────────────────────

function AlertsTab({ alerts, loading, onRun }) {
  const isAiGenerated = alerts.length > 0 && alerts[0].ai_generated;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h2 style={{ margin: 0, fontFamily: "'Syne',sans-serif", fontSize: 20, color: T.text }}>
              AI-Generated Alerts
            </h2>
            {alerts.length > 0 && (
              isAiGenerated
                ? <Chip label="● LIVE AI" color={T.green} bg={T.green + "22"} />
                : <Chip label="◉ DEMO MODE" color={T.purple} bg={T.purple + "22"} />
            )}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: T.muted }}>
            ML forecasting {isAiGenerated ? "+ Gemini analysis" : "(demo — add Google AI key for Gemini)"} across all products
          </p>
        </div>
        <button onClick={onRun} disabled={loading} style={{
          background: loading ? T.card : T.amber,
          color: loading ? T.muted : "#000",
          border: loading ? `1px solid ${T.border}` : "none",
          padding: "10px 22px", borderRadius: 8,
          cursor: loading ? "not-allowed" : "pointer",
          fontWeight: 700, fontSize: 14,
          fontFamily: "'Syne',sans-serif",
          transition: "all 0.2s",
        }}>
          {loading ? "Analysing…" : alerts.length ? "↻ Refresh" : "Run Analysis"}
        </button>
      </div>

      {alerts.length === 0 && !loading && (
        <Card style={{ textAlign: "center", padding: "60px 40px" }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>🤖</div>
          <div style={{ color: T.text, fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            Ready to analyse your inventory
          </div>
          <div style={{ color: T.muted, fontSize: 13, lineHeight: 1.7 }}>
            Click <b style={{ color: T.amber }}>Run Analysis</b> to generate alerts for all 10 products.<br />
            Works without an API key — add <code style={{ color: T.dim, fontSize: 12 }}>GOOGLE_API_KEY</code> to unlock Gemini messages.
          </div>
        </Card>
      )}

      {loading && (
        <>
          <style>{shimmerStyle}</style>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} height={88} />)}
          </div>
        </>
      )}

      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {alerts.map(alert => {
            const s = SEVERITY[alert.severity];
            return (
              <div key={alert.product_id} style={{
                background: T.card, border: `1px solid ${T.border}`,
                borderLeft: `3px solid ${s.color}`,
                borderRadius: 12, padding: "16px 20px",
                display: "grid", gridTemplateColumns: "36px 1fr auto",
                gap: "0 16px", alignItems: "start",
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: s.bg, color: s.color,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 16, fontWeight: 700, flexShrink: 0,
                }}>{s.icon}</div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, color: T.text, fontSize: 14, fontFamily: "'Syne',sans-serif" }}>
                      {alert.product_name}
                    </span>
                    <Badge severity={alert.severity} />
                    <span style={{ fontSize: 11, color: T.muted, textTransform: "capitalize" }}>
                      · {alert.trend} demand
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: T.dim, lineHeight: 1.6 }}>
                    {alert.message}
                  </p>
                </div>

                <div style={{ textAlign: "right", minWidth: 90 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: "'Syne',sans-serif" }}>
                    {alert.days_remaining}d
                  </div>
                  <div style={{ fontSize: 11, color: T.muted }}>remaining</div>
                  {alert.units_to_order > 0 && (
                    <div style={{
                      marginTop: 6, fontSize: 11, color: T.amber,
                      background: T.amber + "18", padding: "3px 8px",
                      borderRadius: 4, fontWeight: 600, whiteSpace: "nowrap",
                    }}>
                      Order {alert.units_to_order} units
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}


// ── Root App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [tab,            setTab]            = useState("dashboard");
  const [summary,        setSummary]        = useState(null);
  const [inventory,      setInventory]      = useState([]);
  const [datasetInfo,    setDatasetInfo]    = useState(null);
  const [alerts,         setAlerts]         = useState([]);
  const [forecast,       setForecast]       = useState(null);
  const [selectedId,     setSelectedId]     = useState(null);
  const [forecastDays,   setForecastDays]   = useState(30);
  const [initialLoading, setInitialLoading] = useState(true);
  const [coldStart,      setColdStart]      = useState(false);
  const [loadingAlerts,  setLoadingAlerts]  = useState(false);
  const [loadingFcast,   setLoadingFcast]   = useState(false);
  const [error,          setError]          = useState(null);

  useEffect(() => {
    // Show "waking up" banner if backend hasn't responded within 3 seconds.
    const wakeTimer = setTimeout(() => setColdStart(true), 3000);
    Promise.all([fetchSummary(), fetchInventory(), fetchDatasetInfo()])
      .then(([s, inv, ds]) => {
        setSummary(s);
        setInventory(inv.data);
        setDatasetInfo(ds);
      })
      .catch((e) => setError(e.message || "Cannot reach the backend. Is FastAPI running on port 8000?"))
      .finally(() => {
        clearTimeout(wakeTimer);
        setColdStart(false);
        setInitialLoading(false);
      });
  }, []);

  const handleSelectProduct = useCallback(async (id, days = forecastDays) => {
    setSelectedId(id);
    setForecast(null);
    setLoadingFcast(true);
    setError(null);
    try {
      const data = await fetchForecast(id, days);
      setForecast(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingFcast(false);
    }
  }, [forecastDays]);

  const handleChangeDays = useCallback((days) => {
    setForecastDays(days);
    if (selectedId) handleSelectProduct(selectedId, days);
  }, [selectedId, handleSelectProduct]);

  const handleViewForecast = useCallback((id) => {
    setTab("forecast");
    handleSelectProduct(id, forecastDays);
  }, [forecastDays, handleSelectProduct]);

  const handleRunAlerts = useCallback(async () => {
    setLoadingAlerts(true);
    setError(null);
    try {
      const data = await fetchAlerts();
      setAlerts(data.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingAlerts(false);
    }
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "'DM Sans',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />

      {/* ── Header ── */}
      <div className="sp-header" style={{
        borderBottom: `1px solid ${T.border}`,
        background: T.card, height: 58,
        display: "flex", alignItems: "center",
        justifyContent: "space-between", padding: "0 32px",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 30, height: 30, background: T.amber,
            borderRadius: 8, display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 15,
          }}>◈</div>
          <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 16 }}>
            StockPilot
          </span>
          <Chip label="v1.0" color={T.muted} bg={T.border + "66"} />
        </div>

        <nav className="sp-header-nav" style={{ display: "flex", gap: 4 }}>
          {["dashboard", "forecast", "alerts"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: tab === t ? T.amber + "18" : "transparent",
              border: `1px solid ${tab === t ? T.amber : "transparent"}`,
              color: tab === t ? T.amber : T.muted,
              padding: "6px 16px", borderRadius: 8,
              cursor: "pointer", fontSize: 13, fontWeight: 600,
              textTransform: "capitalize", transition: "all 0.12s",
            }}>{t}</button>
          ))}
        </nav>
      </div>

      {/* ── Page content ── */}
      <div className="sp-container" style={{ maxWidth: 1260, margin: "0 auto", padding: "28px 32px" }}>
        {error && <ErrorBanner message={error} />}
        {coldStart && initialLoading && <WakingBanner />}

        {tab === "dashboard" && (
          <DashboardTab
            summary={summary}
            inventory={inventory}
            datasetInfo={datasetInfo}
            onViewForecast={handleViewForecast}
            initialLoading={initialLoading}
          />
        )}

        {tab === "forecast" && (
          <ForecastTab
            inventory={inventory}
            selectedId={selectedId}
            onSelect={handleSelectProduct}
            onChangeDays={handleChangeDays}
            forecastDays={forecastDays}
            forecast={forecast}
            loading={loadingFcast}
          />
        )}

        {tab === "alerts" && (
          <AlertsTab
            alerts={alerts}
            loading={loadingAlerts}
            onRun={handleRunAlerts}
          />
        )}
      </div>

      {/* ── Footer ── */}
      <footer style={{
        borderTop: `1px solid ${T.border}`,
        padding: "20px 32px 28px",
        textAlign: "center",
        color: T.muted,
        fontSize: 12,
        marginTop: 40,
      }}>
        Built by{" "}
        <a href="https://github.com/parvarora2001" target="_blank" rel="noreferrer"
           style={{ color: T.amber, textDecoration: "none" }}>
          Parv Arora
        </a>
        {" · "}
        <a href="https://github.com/parvarora2001/StockPilot-AI-based-Inventory-System" target="_blank" rel="noreferrer"
           style={{ color: T.amber, textDecoration: "none" }}>
          Source on GitHub ↗
        </a>
      </footer>
    </div>
  );
}
