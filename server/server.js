import express from "express";
import http from "http";
import cors from "cors";
import { WebSocketServer } from "ws";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const wss = new WebSocketServer({ server });

const ALERT_SOURCE_URL = "https://www.oref.org.il/WarningMessages/alert/alerts.json";

let lastAlertSignature = null;
let lastAlertObject = null;
let history = [];

let debugState = {
  pollCount: 0,
  lastFetchAt: null,
  lastHttpStatus: null,
  lastTextSample: null,
  lastError: null,
  lastParsedOk: false,
};


const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
};

const categoryMap = {
  1: "ירי רקטות וטילים",
  2: "חשש לחדירת מחבלים",
  3: "רעידת אדמה",
  4: "אירוע חומרים מסוכנים",
  5: "אירוע ביטחוני",
  6: "חדירת כלי טיס עוין",
  10: "הודעת מצב",
};

function rtl(text) {
  return String(text).split("").reverse().join("");
}

function colorize(text, color) {
  return `${color}${text}${colors.reset}`;
}

function printLine(text, color = colors.white) {
  console.log(colorize(rtl(text), color));
}

function printDivider(color = colors.dim) {
  console.log(colorize("========================================", color));
}

function nowStr() {
  return new Date().toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
  });
}

function buildSignature(alert) {
  const title = alert?.title ?? "";
  const desc = alert?.desc ?? "";
  const areas = Array.isArray(alert?.data)
    ? alert.data.slice().sort((a, b) => a.localeCompare(b, "he")).join("|")
    : "";

  return `${title}__${desc}__${areas}`;
}

function includesOneOf(text, phrases) {
  const safeText = String(text || "").trim();
  return phrases.some((phrase) => safeText.includes(phrase));
}

function normalizeText(text) {
  return String(text || "")
    .replace(/["'׳״]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveAlertKind(raw) {
  const cat = Number(raw?.cat ?? 0);
  const title = normalizeText(raw?.title ?? "");
  const desc = normalizeText(raw?.desc ?? "");

  const isEnded =
    includesOneOf(title, ["האירוע הסתיים"]) ||
    includesOneOf(desc, ["האירוע הסתיים", "יכולים לצאת"]);

  const isEarlyWarning =
    includesOneOf(title, ["התראה מוקדמת", "התראה מקדימה"]) ||
    includesOneOf(desc, ["התראה מוקדמת", "התראה מקדימה"]);

  if (isEnded) {
    return "ended";
  }

  if (cat === 10) {
    return "early";
  }

  if (isEarlyWarning) {
    return "early";
  }

  return "live";
}

function resolveCategoryName(raw) {
  const cat = Number(raw?.cat ?? 0);
  const kind = resolveAlertKind(raw);

  if (kind === "early") {
    return "התראה מוקדמת";
  }

  if (kind === "ended") {
    return "האירוע הסתיים";
  }

  return categoryMap[cat] || "קטגוריה לא ידועה";
}

function sortAreasHebrew(areas) {
  return [...areas].sort((a, b) => a.localeCompare(b, "he"));
}

function normalizeAlert(raw) {
  const areas = Array.isArray(raw?.data) ? sortAreasHebrew(raw.data) : [];
  const categoryCode = Number(raw?.cat ?? 0);
  const alertKind = resolveAlertKind(raw);

  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: raw?.title ?? "התרעה",
    desc: raw?.desc ?? "",
    areas,
    category: categoryCode,
    categoryName: resolveCategoryName(raw),
    alertKind,
    receivedAt: new Date().toISOString(),
  };
}

function getCategoryColor(alert) {
  if (alert?.alertKind === "ended") return colors.green;
  if (alert?.alertKind === "early") return colors.yellow;

  const category = Number(alert?.category ?? 0);

  switch (category) {
    case 1:
      return colors.red;
    case 6:
      return colors.cyan;
    default:
      return colors.white;
  }
}

function printAlert(alert) {
  const categoryColor = getCategoryColor(alert);

  console.log("");
  printDivider(colors.dim);
  printLine(`זמן קליטה: ${nowStr()}`, colors.green);
  printLine(`כותרת: ${alert.title}`, colors.bright + colors.yellow);
  printLine(`תיאור: ${alert.desc || "ללא תיאור"}`, colors.white);
  printLine(`קטגוריה: ${alert.category}`, categoryColor);
  printLine(`סוג קטגוריה: ${alert.categoryName}`, categoryColor);
  printLine(`סוג אירוע פנימי: ${alert.alertKind}`, colors.blue);
  printLine(`יישובים (${alert.areas.length}):`, colors.magenta);

  alert.areas.forEach((city) => {
    printLine(`• ${city}`, colors.cyan);
  });

  printDivider(colors.dim);
  console.log("");
}

function printHeartbeat() {
  printLine(`השרת פעיל: ${nowStr()}`, colors.dim);
}

function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload });

  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

function scheduleNextFetch() {
  const delay = 1800 + Math.random() * 400;
  setTimeout(fetchAlerts, delay);
}



async function fetchAlerts() {
  debugState.pollCount += 1;
  debugState.lastFetchAt = new Date().toISOString();
  debugState.lastError = null;
  debugState.lastParsedOk = false;

  try {
    const res = await fetch(ALERT_SOURCE_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json, text/plain, */*",
        Referer: "https://www.oref.org.il/",
        Connection: "keep-alive",
      },
    });

    debugState.lastHttpStatus = res.status;

    if (!res.ok) {
      debugState.lastTextSample = `HTTP ${res.status}`;
      scheduleNextFetch();
      return;
    }

    const text = await res.text();
    debugState.lastTextSample = text ? text.slice(0, 300) : "(empty)";

    if (!text || text.length < 5) {
      scheduleNextFetch();
      return;
    }

    let raw;
    try {
      raw = JSON.parse(text);
      debugState.lastParsedOk = true;
    } catch (err) {
      debugState.lastError = `JSON parse failed: ${err.message}`;
      scheduleNextFetch();
      return;
    }

    if (!raw || !Array.isArray(raw.data) || raw.data.length === 0) {
      scheduleNextFetch();
      return;
    }

    const signature = buildSignature(raw);

    if (signature !== lastAlertSignature) {
      lastAlertSignature = signature;

      const normalized = normalizeAlert(raw);
      lastAlertObject = normalized;

      history.unshift(normalized);
      history = history.slice(0, 100);

      printAlert(normalized);

      if (typeof broadcast === "function") {
        broadcast("alert", normalized);
      }
    }
  } catch (err) {
    debugState.lastError = err.message;
  }

  scheduleNextFetch();
}




wss.on("connection", (ws) => {
  ws.send(
    JSON.stringify({
      type: "init",
      payload: {
        lastAlert: lastAlertObject,
        history,
      },
    })
  );
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/last-alert", (req, res) => {
  res.json(lastAlertObject);
});

app.get("/api/history", (req, res) => {
  res.json(history);
});

app.get("/debug", (req, res) => {
  res.json({
    debugState,
    lastAlertObject,
    historyCount: history.length,
  });
});
setInterval(printHeartbeat, 60000);

server.listen(PORT, () => {
  printLine(`השרת רץ בכתובת http://localhost:${PORT}`, colors.green);
  printLine("מאזין להתראות פיקוד העורף", colors.bright + colors.yellow);
  console.log("");
  fetchAlerts();
});