import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap } from "react-leaflet";
import L from "leaflet";
import "./App.css";
import { cityCoords } from "./data/cities";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const SOUND_MAP = {
  "באר שבע": "/sounds/sepultura.mp3",
  "חיפה": "/sounds/haifa.mp3",
  "ירושלים": "/sounds/jerusalem.mp3",
  "תל אביב": "/sounds/telaviv.mp3",
};

const DEFAULT_BELL_SOUND = "/sounds/315618__modularsamples__yamaha-cs-30l-whoopie-bass-c5-whoopie-bass-72-127.aiff";

function normalizeCityName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .replace(/["'׳״]/g, "")
    .trim();
}

function findCoordsByCityName(cityName) {
  if (!cityName) return null;

  const normalizedInput = normalizeCityName(cityName);

  if (cityCoords[normalizedInput]) {
    return { ...cityCoords[normalizedInput], label: cityName };
  }

  const matchedKey = Object.keys(cityCoords).find((key) => {
    const normalizedKey = normalizeCityName(key);
    return normalizedInput.includes(normalizedKey) || normalizedKey.includes(normalizedInput);
  });

  if (!matchedKey) return null;

  return { ...cityCoords[matchedKey], label: cityName };
}

function cityMatchesKey(city, key) {
  const normalizedCity = normalizeCityName(city);
  const normalizedKey = normalizeCityName(key);

  return (
    normalizedCity.includes(normalizedKey) ||
    normalizedKey.includes(normalizedCity)
  );
}

function findMetalSoundForAlert(alert) {
  for (const city of alert?.areas || []) {
    for (const key of Object.keys(SOUND_MAP)) {
      if (cityMatchesKey(city, key)) {
        return SOUND_MAP[key];
      }
    }
  }

  return null;
}

async function tryPlay(src) {
  const audio = new Audio(src);
  audio.preload = "auto";
  await audio.play();
}

async function playSoundsForAlert(alert, soundEnabled) {
  if (!soundEnabled || !alert) return;

  if (alert.alertKind === "ended") {
    return;
  }

  try {
    await tryPlay(DEFAULT_BELL_SOUND);
  } catch {}

  if (alert.alertKind === "early") {
    const metalSound = findMetalSoundForAlert(alert);
    if (metalSound) {
      setTimeout(() => {
        tryPlay(metalSound).catch(() => {});
      }, 150);
    }
  }
}

function FitMapToMarkers({ points }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return;

    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 10);
      return;
    }

    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [points, map]);

  return null;
}

export default function App() {
  const [lastAlert, setLastAlert] = useState(null);
  const [history, setHistory] = useState([]);
  const [status, setStatus] = useState("טוען...");
  const [soundEnabled, setSoundEnabled] = useState(false);

  const lastPlayedAlertIdRef = useRef(null);

  async function loadData() {
    try {
      const [lastRes, historyRes] = await Promise.all([
        fetch("/api/last-alert"),
        fetch("/api/history"),
      ]);

      const lastData = await lastRes.json();
      const historyData = await historyRes.json();

      setLastAlert(lastData);
      setHistory(Array.isArray(historyData) ? historyData : []);
      setStatus("מחובר");
    } catch {
      setStatus("שגיאת חיבור");
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!lastAlert?.id) return;
    if (lastPlayedAlertIdRef.current === lastAlert.id) return;

    lastPlayedAlertIdRef.current = lastAlert.id;
    playSoundsForAlert(lastAlert, soundEnabled);
  }, [lastAlert, soundEnabled]);

  const alertPoints = useMemo(() => {
    if (!lastAlert?.areas?.length) return [];
    return lastAlert.areas
      .map((city) => findCoordsByCityName(city))
      .filter(Boolean);
  }, [lastAlert]);

  async function enableSound() {
    try {
      const warmup = new Audio(DEFAULT_BELL_SOUND);
      warmup.preload = "auto";
      warmup.muted = true;
      await warmup.play();
      warmup.pause();
      warmup.currentTime = 0;
      warmup.muted = false;
      setSoundEnabled(true);
    } catch {
      setSoundEnabled(true);
    }
  }

  return (
    <div className="app" dir="rtl">
      <header className="header">
        <div>
          <h1>מפת אזעקות בזמן אמת</h1>
          <p className="sub">התראה אחרונה והיסטוריה מהמנוע שלך</p>
        </div>

        <div className="header-actions">
          <div className="status">{status}</div>
          <button className="sound-btn" onClick={enableSound}>
            {soundEnabled ? "סאונד פעיל" : "הפעלת סאונד"}
          </button>
        </div>
      </header>

      <div className="layout">
        <section className="card map-card">
          <h2>מפת ישראל</h2>

          <div className="map-wrap">
            <MapContainer center={[31.5, 34.9]} zoom={7} scrollWheelZoom={true} className="map">
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              <FitMapToMarkers points={alertPoints} />

              {alertPoints.map((point, index) => (
                <Marker key={`${point.label}-${index}`} position={[point.lat, point.lng]}>
                  <Popup>
                    <strong>{point.label}</strong>
                    <br />
                    {lastAlert?.title || "התראה"}
                  </Popup>
                </Marker>
              ))}

              {alertPoints.map((point, index) => (
                <CircleMarker
                  key={`circle-${point.label}-${index}`}
                  center={[point.lat, point.lng]}
                  radius={18}
                  pathOptions={{
                    color: "#ef4444",
                    fillColor: "#ef4444",
                    fillOpacity: 0.25,
                  }}
                />
              ))}
            </MapContainer>
          </div>
        </section>

        <section className="side">
          <section className="card">
            <h2>התראה אחרונה</h2>

            {!lastAlert ? (
              <p>אין כרגע התראה להצגה</p>
            ) : (
              <div className="alert-box">
                <p><strong>כותרת:</strong> {lastAlert.title}</p>
                <p><strong>תיאור:</strong> {lastAlert.desc || "ללא תיאור"}</p>
                <p><strong>קטגוריה:</strong> {lastAlert.category}</p>
                <p><strong>סוג קטגוריה:</strong> {lastAlert.categoryName}</p>
                <p><strong>סוג פנימי:</strong> {lastAlert.alertKind}</p>
                <p><strong>זמן:</strong> {new Date(lastAlert.receivedAt).toLocaleString("he-IL")}</p>

                <div>
                  <strong>יישובים:</strong>
                  <ul>
                    {lastAlert.areas?.map((city, index) => (
                      <li key={`${city}-${index}`}>{city}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>

          <section className="card">
            <h2>היסטוריה</h2>

            {history.length === 0 ? (
              <p>אין היסטוריה עדיין</p>
            ) : (
              <div className="history-list">
                {history.map((item) => (
                  <div className="history-item" key={item.id}>
                    <div><strong>{item.title}</strong></div>
                    <div>{item.categoryName}</div>
                    <div>{item.areas?.join(", ")}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </section>
      </div>
    </div>
  );
}