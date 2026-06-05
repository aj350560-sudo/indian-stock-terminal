// netlify/functions/stock.js
// Server-side proxy — API keys never reach the browser

const ALPHAVANTAGE_KEY = process.env.ALPHAVANTAGE_KEY;
const ANTHROPIC_KEY    = process.env.ANTHROPIC_KEY;

// NSE symbol map for common searches
const SYMBOL_MAP = {
  "reliance": "RELIANCE.BSE",
  "reliance industries": "RELIANCE.BSE",
  "tcs": "TCS.BSE",
  "tata consultancy": "TCS.BSE",
  "infosys": "INFY",
  "hdfc bank": "HDB",
  "hdfc": "HDB",
  "wipro": "WIT",
  "icici bank": "IBN",
  "icici": "IBN",
  "axis bank": "AXISBANK.BSE",
  "bajaj finance": "BAJFINANCE.BSE",
  "bharti airtel": "BHARTIARTL.BSE",
  "airtel": "BHARTIARTL.BSE",
  "itc": "ITC.BSE",
  "larsen toubro": "LT.BSE",
  "l&t": "LT.BSE",
  "maruti": "MARUTI.BSE",
  "maruti suzuki": "MARUTI.BSE",
  "asian paints": "ASIANPAINT.BSE",
  "hul": "HINDUNILVR.BSE",
  "hindustan unilever": "HINDUNILVR.BSE",
  "sun pharma": "SUNPHARMA.BSE",
  "kotak": "KOTAKBANK.BSE",
  "kotak mahindra": "KOTAKBANK.BSE",
  "titan": "TITAN.BSE",
  "nestle": "NESTLEIND.BSE",
  "ultratech": "ULTRACEMCO.BSE",
  "tech mahindra": "TECHM.BSE",
  "dr reddy": "DRREDDY.BSE",
  "cipla": "CIPLA.BSE",
  "adani enterprises": "ADANIENT.BSE",
  "adani ports": "ADANIPORTS.BSE",
  "power grid": "POWERGRID.BSE",
  "ntpc": "NTPC.BSE",
  "ongc": "ONGC.BSE",
  "sbi": "SBIN.BSE",
  "state bank": "SBIN.BSE",
};

function resolveSymbol(query) {
  const q = query.toLowerCase().trim();
  if (SYMBOL_MAP[q]) return SYMBOL_MAP[q];
  // Try partial match
  for (const [key, val] of Object.entries(SYMBOL_MAP)) {
    if (q.includes(key) || key.includes(q)) return val;
  }
  // Fallback: treat as direct symbol, try BSE suffix
  return query.toUpperCase().replace(/\s+/g, "") + ".BSE";
}

async function fetchQuote(symbol) {
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${ALPHAVANTAGE_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data["Global Quote"] || null;
}

async function fetchOverview(symbol) {
  const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${ALPHAVANTAGE_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return (data && data.Symbol) ? data : null;
}

async function fetchIncomeStatement(symbol) {
  const url = `https://www.alphavantage.co/query?function=INCOME_STATEMENT&symbol=${symbol}&apikey=${ALPHAVANTAGE_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  const latest = data?.annualReports?.[0] || null;
  return latest;
}

function inrFormat(num) {
  if (!num || isNaN(num)) return null;
  const n = parseFloat(num);
  if (n >= 1e12) return "₹" + (n / 1e12).toFixed(2) + "L Cr";
  if (n >= 1e9)  return "₹" + (n / 1e9).toFixed(2) + " Cr";
  if (n >= 1e7)  return "₹" + (n / 1e7).toFixed(2) + " L";
  return "₹" + n.toLocaleString("en-IN");
}

async function getAISummary(stockData) {
  if (!ANTHROPIC_KEY) return null;

  const prompt = `You are a concise Indian equity analyst. Given this stock data:
Company: ${stockData.fullName}
Symbol: ${stockData.symbol}
Sector: ${stockData.sector}
Current Price: ₹${stockData.currentPrice}
Market Cap: ${stockData.marketCap}
PE Ratio: ${stockData.peRatio}
EPS: ${stockData.eps}
Revenue: ${stockData.revenue}
Net Profit: ${stockData.netProfit}
ROE: ${stockData.roe}%
Debt/Equity: ${stockData.debtToEquity}

Respond ONLY with a JSON object (no markdown):
{
  "summary": "3-sentence analyst note covering business model, financial health, and current positioning",
  "bullCase": "One crisp bull case sentence",
  "bearCase": "One crisp bear case sentence",
  "sentimentScore": <integer 0-100>
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const data = await res.json();
  const text = data?.content?.[0]?.text || "";
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
    return JSON.parse(clean.slice(s, e + 1));
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const query = event.queryStringParameters?.q || "";
  if (!query) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing query parameter ?q=" }) };
  }

  if (!ALPHAVANTAGE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "ALPHAVANTAGE_KEY not configured in Netlify env vars" }) };
  }

  try {
    const symbol = resolveSymbol(query);

    // Parallel fetch: quote + overview
    const [quote, overview, income] = await Promise.all([
      fetchQuote(symbol),
      fetchOverview(symbol),
      fetchIncomeStatement(symbol)
    ]);

    if (!quote || !quote["05. price"]) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: `No data found for "${query}". Try using the exact NSE symbol like RELIANCE, TCS, INFY.` })
      };
    }

    const price    = parseFloat(quote["05. price"]);
    const change   = parseFloat(quote["09. change"]);
    const changePct = parseFloat(quote["10. change percent"]?.replace("%",""));
    const high52   = parseFloat(quote["03. high"]);
    const low52    = parseFloat(quote["04. low"]);

    const peRatio  = parseFloat(overview?.PERatio)   || null;
    const pbRatio  = parseFloat(overview?.PriceToBookRatio) || null;
    const eps      = parseFloat(overview?.EPS)        || null;
    const roe      = parseFloat(overview?.ReturnOnEquityTTM) * 100 || null;
    const de       = parseFloat(overview?.DebtEquityRatio)   || null;
    const divYield = parseFloat(overview?.DividendYield) * 100 || null;
    const bookVal  = parseFloat(overview?.BookValue)   || null;
    const mktCap   = parseFloat(overview?.MarketCapitalization) || null;
    const revenue52  = parseFloat(income?.totalRevenue) || null;
    const netIncome  = parseFloat(income?.netIncome)    || null;
    const w52High  = parseFloat(overview?.["52WeekHigh"]) || null;
    const w52Low   = parseFloat(overview?.["52WeekLow"])  || null;

    const stockData = {
      symbol:       overview?.Symbol || symbol,
      fullName:     overview?.Name   || query,
      exchange:     overview?.Exchange || "NSE/BSE",
      sector:       overview?.Sector || overview?.Industry || "Equity",
      currentPrice: price.toFixed(2),
      priceChange:  change.toFixed(2),
      priceChangePct: changePct?.toFixed(2) || "0.00",
      marketCap:    inrFormat(mktCap)   || "N/A",
      peRatio:      peRatio?.toFixed(1) || null,
      pbRatio:      pbRatio?.toFixed(2) || null,
      eps:          eps?.toFixed(2)     || null,
      roe:          roe?.toFixed(1)     || null,
      debtToEquity: de?.toFixed(2)      || null,
      dividendYield: divYield?.toFixed(2) || null,
      bookValue:    bookVal?.toFixed(2) || null,
      revenue:      inrFormat(revenue52) || "N/A",
      netProfit:    inrFormat(netIncome) || "N/A",
      week52High:   (w52High || high52)?.toFixed(2) || null,
      week52Low:    (w52Low  || low52)?.toFixed(2)  || null,
      avgVolume:    overview?.SharesFloat ? (parseFloat(overview.SharesFloat)/1e7).toFixed(2) + " Cr" : "N/A",
      description:  overview?.Description || null,
      sentimentScore: 55,
      summary: null,
      bullCase: null,
      bearCase: null,
    };

    // AI summary (non-blocking — if Anthropic key missing, still return data)
    const ai = await getAISummary(stockData);
    if (ai) {
      stockData.summary       = ai.summary;
      stockData.bullCase      = ai.bullCase;
      stockData.bearCase      = ai.bearCase;
      stockData.sentimentScore = ai.sentimentScore;
    }

    return { statusCode: 200, headers, body: JSON.stringify(stockData) };

  } catch (err) {
    console.error("Stock function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server error: " + err.message })
    };
  }
};
