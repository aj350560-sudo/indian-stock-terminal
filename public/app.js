/* ============================================
   NSE/BSE Terminal — app.js
   Calls our secure Netlify serverless proxy
   ============================================ */

const searchInput = document.getElementById("stockSearch");
const searchBtn   = document.getElementById("searchBtn");
const mainContent = document.getElementById("mainContent");

// ── Event listeners ──────────────────────────────────────────────────────────
searchInput.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });
searchBtn.addEventListener("click", doSearch);

// ── Quick search from chips ───────────────────────────────────────────────────
function quickSearch(name) {
  searchInput.value = name;
  doSearch();
}

// ── Main search function ──────────────────────────────────────────────────────
async function doSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    searchInput.focus();
    return;
  }

  searchBtn.disabled = true;
  setLoading(query);

  try {
    // Calls our secure Netlify function — API keys stay on the server
    const res = await fetch(`/.netlify/functions/stock?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!res.ok || data.error) {
      showError(data.error || "Something went wrong. Try again.");
    } else {
      renderStock(data);
    }
  } catch (err) {
    showError("Network error. Please check your connection and try again.");
  }

  searchBtn.disabled = false;
}

// ── Loading state ─────────────────────────────────────────────────────────────
function setLoading(query) {
  mainContent.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <div class="loading-text">FETCHING "${query.toUpperCase()}"</div>
      <div class="loading-sub">Querying NSE/BSE data + AI analysis...</div>
    </div>`;
}

// ── Error state ───────────────────────────────────────────────────────────────
function showError(msg) {
  mainContent.innerHTML = `
    <div class="error-box">
      <i class="ti ti-alert-triangle"></i>
      <div>
        <strong>Not found</strong><br>
        ${msg}<br>
        <small style="color:var(--text-dim);margin-top:6px;display:block">
          Try exact NSE symbols: RELIANCE, TCS, INFY, HDFCBANK, WIPRO, ICICIBANK
        </small>
      </div>
    </div>`;
}

// ── Format helpers ────────────────────────────────────────────────────────────
function fmt(val, prefix = "", suffix = "", fallback = "N/A") {
  if (val === null || val === undefined || val === "" || val === "N/A") return fallback;
  return `${prefix}${val}${suffix}`;
}

function priceStr(val) {
  if (!val) return "N/A";
  const n = parseFloat(val);
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Render stock card ─────────────────────────────────────────────────────────
function renderStock(s) {
  const chg     = parseFloat(s.priceChange) || 0;
  const pct     = parseFloat(s.priceChangePct) || 0;
  const chgClass = chg > 0 ? "up" : chg < 0 ? "down" : "neutral";
  const chgSign  = chg > 0 ? "+" : "";

  const sentiment = Math.min(100, Math.max(0, parseInt(s.sentimentScore) || 50));
  const sentColor = sentiment > 60 ? "var(--accent-green)" : sentiment < 40 ? "var(--accent-red)" : "var(--accent-amber)";
  const sentLabel = sentiment > 60 ? "Bullish" : sentiment < 40 ? "Bearish" : "Neutral";

  const price   = parseFloat(s.currentPrice) || 0;
  const w52High = parseFloat(s.week52High) || price;
  const w52Low  = parseFloat(s.week52Low)  || price;
  const rangeRange = w52High - w52Low || 1;
  const rangePos   = Math.min(100, Math.max(0, ((price - w52Low) / rangeRange) * 100));

  const now = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) + " IST";

  mainContent.innerHTML = `
    <div class="stock-card">

      <!-- HEADER -->
      <div class="stock-header">
        <div>
          <div class="stock-symbol-badge">
            <span>${s.symbol || "—"}</span>
            <span class="exchange-badge">${s.exchange || "NSE/BSE"}</span>
          </div>
          <div class="stock-fullname">${s.fullName || s.symbol}</div>
          <div class="stock-sector">${s.sector || "Equity"}</div>
        </div>
        <div class="price-block">
          <div class="price-main">${priceStr(s.currentPrice)}</div>
          <div class="price-change ${chgClass}">
            ${chgSign}₹${Math.abs(chg).toFixed(2)}
            &nbsp;(${chgSign}${pct.toFixed(2)}%)
          </div>
          <div class="price-timestamp">As of ${now}</div>
        </div>
      </div>

      <!-- FUNDAMENTALS GRID -->
      <div class="fund-grid">
        ${fundCard("Market Cap",   s.marketCap,   "Total valuation")}
        ${fundCard("P/E Ratio",    s.peRatio ? Number(s.peRatio).toFixed(1) : null, "Price / earnings")}
        ${fundCard("EPS",          s.eps ? "₹" + Number(s.eps).toFixed(2) : null, "Earnings per share")}
        ${fundCard("Revenue",      s.revenue,     "Annual revenue")}
        ${fundCard("Net Profit",   s.netProfit,   "Profit after tax")}
        ${fundCard("P/B Ratio",    s.pbRatio ? Number(s.pbRatio).toFixed(2) : null, "Price / book")}
      </div>

      <!-- SENTIMENT BAR -->
      <div class="sentiment-wrap">
        <div class="sentiment-header">
          <span>Bearish</span>
          <span class="sentiment-score-label" style="color:${sentColor}">${sentLabel} · ${sentiment}/100</span>
          <span>Bullish</span>
        </div>
        <div class="sentiment-bar">
          <div class="sentiment-fill" style="width:${sentiment}%;background:${sentColor}"></div>
        </div>
      </div>

      <!-- 52W RANGE -->
      <div class="range-bar-wrap">
        <div class="range-labels">
          <span>52W Low: ${fmt(s.week52Low, "₹")}</span>
          <span>Current: ${priceStr(s.currentPrice)}</span>
          <span>52W High: ${fmt(s.week52High, "₹")}</span>
        </div>
        <div class="range-bar">
          <div class="range-fill" style="width:${rangePos}%"></div>
          <div class="range-dot" style="left:${rangePos}%"></div>
        </div>
      </div>

      <!-- AI SUMMARY -->
      ${s.summary ? `
      <div class="summary-box">
        <div class="summary-title">▸ AI FUNDAMENTAL ANALYSIS</div>
        <div class="summary-text">${s.summary}</div>
        ${s.bullCase && s.bearCase ? `
          <div class="bull-bear-grid" style="margin-top:14px">
            <div class="bull-box">
              <div class="bull-lbl">▲ BULL CASE</div>
              <div class="bull-text">${s.bullCase}</div>
            </div>
            <div class="bear-box">
              <div class="bear-lbl">▼ BEAR CASE</div>
              <div class="bear-text">${s.bearCase}</div>
            </div>
          </div>` : ""}
      </div>` : ""}

      <!-- DESCRIPTION -->
      ${s.description ? `
      <div class="summary-box">
        <div class="summary-title">▸ COMPANY OVERVIEW</div>
        <div class="summary-text">${s.description.slice(0, 420)}${s.description.length > 420 ? "…" : ""}</div>
      </div>` : ""}

      <!-- ADDITIONAL METRICS -->
      <div class="metrics-grid">
        ${metricRow("ROE",          s.roe      ? s.roe + "%" : null)}
        ${metricRow("Debt/Equity",  s.debtToEquity)}
        ${metricRow("Book Value",   s.bookValue ? "₹" + Number(s.bookValue).toLocaleString("en-IN") : null)}
        ${metricRow("Div. Yield",   s.dividendYield ? s.dividendYield + "%" : null)}
        ${metricRow("Avg Volume",   s.avgVolume)}
        ${metricRow("Sector",       s.sector)}
      </div>

      <!-- DISCLAIMER -->
      <div class="disclaimer">
        <i class="ti ti-info-circle" style="flex-shrink:0;margin-top:1px"></i>
        <span>Data sourced from Alpha Vantage (NSE/BSE). Prices may be delayed 15–20 minutes.
        This is for informational and educational purposes only — not financial advice.
        Always do your own research before investing.</span>
      </div>

    </div>`;
}

function fundCard(label, value, sub) {
  const v = (value === null || value === undefined || value === "") ? "N/A" : value;
  return `
    <div class="fund-card">
      <div class="fund-label">${label}</div>
      <div class="fund-value">${v}</div>
      <div class="fund-sub">${sub}</div>
    </div>`;
}

function metricRow(label, value) {
  const v = (value === null || value === undefined || value === "") ? "—" : value;
  return `
    <div class="metric-row">
      <div class="metric-lbl">${label}</div>
      <div class="metric-val">${v}</div>
    </div>`;
}
