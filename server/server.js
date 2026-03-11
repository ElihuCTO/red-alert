import express from "express";
import http from "http";
import cors from "cors";
import { exec } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const PORT = 3000;

const ALERT_SOURCE_URL = "https://www.oref.org.il/WarningMessages/alert/alerts.json";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOUND_MAP = {
  "באר שבע": "sepultura.mp3",
  "חיפה": "pantera.mp3",
  "ירושלים": "megadeth.mp3",
  "תל אביב": "slayer.mp3",
};

const DEFAULT_BELL_SOUND =
  "315618__modularsamples__yamaha-cs-30l-whoopie-bass-c5-whoopie-bass-72-127.aiff";

let lastAlertSignature = null;
let lastAlertObject = null;
let history = [];

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

function resolveAlertKind(raw) {
  const cat = Number(raw?.cat ?? 0);
  const title = String(raw?.title ?? "").trim();
  const desc = String(raw?.desc ?? "").trim();

  const isEnded =
    includesOneOf(title, ["האירוע הסתיים"]) ||
    includesOneOf(desc, ["האירוע הסתיים", "יכולים לצאת"]);

  const isEarlyWarning =
    includesOneOf(title, ["התראה מוקדמת"]) ||
    includesOneOf(desc, ["התראה מוקדמת"]);

  if (cat === 10 && isEnded) {
    return "ended";
  }

  if (cat === 10 && isEarlyWarning) {
    return "early";
  }

  if (isEnded) {
    return "ended";
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

function playSoundFile(filename) {
  const soundPath = path.join(__dirname, filename);
  exec(`afplay "${soundPath}"`, () => {});
}

function normalizeCityText(text) {
  return String(text || "")
    .replace(/["'׳״]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cityMatchesKey(city, key) {
  const normalizedCity = normalizeCityText(city);
  const normalizedKey = normalizeCityText(key);

  return (
    normalizedCity.includes(normalizedKey) ||
    normalizedKey.includes(normalizedCity)
  );
}

function findMetalSoundForAlert(alert) {
  for (const city of alert.areas) {
    for (const key of Object.keys(SOUND_MAP)) {
      if (cityMatchesKey(city, key)) {
        return SOUND_MAP[key];
      }
    }
  }

  return null;
}

function playSoundsForAlert(alert) {
  if (alert.alertKind === "ended") {
    return;
  }

  playSoundFile(DEFAULT_BELL_SOUND);

  if (alert.alertKind === "early") {
    const metalSound = findMetalSoundForAlert(alert);

    if (metalSound) {
      setTimeout(() => {
        playSoundFile(metalSound);
      }, 150);
    }
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

function scheduleNextFetch() {
  const delay = 1800 + Math.random() * 400;
  setTimeout(fetchAlerts, delay);
}

async function fetchAlerts() {
  try {
    const res = await fetch(ALERT_SOURCE_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
        Referer: "https://www.oref.org.il/",
        Connection: "keep-alive",
      },
    });

    if (!res.ok) {
      scheduleNextFetch();
      return;
    }

    const text = await res.text();

    if (!text || text.length < 5) {
      scheduleNextFetch();
      return;
    }

    let raw;

    try {
      raw = JSON.parse(text);
    } catch {
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
      playSoundsForAlert(normalized);
    }
  } catch {}

  scheduleNextFetch();
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/last-alert", (req, res) => {
  res.json(lastAlertObject);
});

app.get("/api/history", (req, res) => {
  res.json(history);
});

setInterval(printHeartbeat, 60000);

server.listen(PORT, () => {
  printLine(`השרת רץ בכתובת http://localhost:${PORT}`, colors.green);
  printLine("מאזין להתראות פיקוד העורף", colors.bright + colors.yellow);
  console.log("");
  fetchAlerts();
});