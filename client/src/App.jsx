import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  CircleMarker,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "./App.css";
import { cityCoords } from "./data/cities";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "https://red-alert-wso0.onrender.com";

const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL ||
  "wss://red-alert-wso0.onrender.com";

const SOUND_MAP = {
  "באר שבע": "/sounds/sepultura.mp3",
  "חיפה": "/sounds/haifa.mp3",
  "ירושלים": "/sounds/jerusalem.mp3",
  "תל אביב": "/sounds/telaviv.mp3",
};

const DEFAULT_BELL_SOUND = "/sounds/bell.aiff";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function normalizeCityName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .replace(/["'׳״]/g, "")
    .trim();
}

function cityMatchesKey(city, key) {
  const normalizedCity = normalizeCityName(city);
  const normalizedKey = normalizeCityName(key);

  return (
    normalizedCity.includes(normalizedKey) ||
    normalizedKey.includes(normalizedCity)
  );
}

function findCoordsByCityName(cityName) {
  if (!cityName) return null;

  const normalizedInput = normalizeCityName(cityName);

  if (cityCoords[normalizedInput]) {
    return { ...cityCoords[normalizedInput], label: cityName };
  }

  const matchedKey = Object.keys(cityCoords).find((key) => {
    const normalizedKey = normalizeCityName(key);
    return (
      normalizedInput.includes(normalizedKey) ||
      normalizedKey.includes(normalizedInput)
    );
  });

  if (!matchedKey) return null;

  return { ...cityCoords[matchedKey], label: cityName };
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

async function playAudio(src) {
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
    await playAudio(DEFAULT_BELL_SOUND);
  } catch {}

  if (alert.alertKind === "early") {
    const metalSound = findMetalSoundForAlert(alert);

    if (metalSound) {
      setTimeout(() => {
        playAudio(metalSound).catch(() => {});
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
  const [status, setStatus] = useState("מתחבר...");
  const [soundEnabled, setSoundEnabled] = useState(false);

  const lastPlayedAlertId = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  const alertPoints = useMemo(() => {
    if (!lastAlert?.areas?.length) return [];

    return lastAlert.areas
      .map((city) => findCoordsByCityName(city))
      .filter(Boolean);
  }, [lastAlert]);

  useEffect(() => {
    let ws;

    function connect() {
      ws = new WebSocket(WS_BASE_URL);

      ws.onopen = () => {
        setStatus("מחובר בלייב");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "init") {
            if (msg.payload?.lastAlert) {
              setLastAlert(msg.payload.lastAlert);
            }

            if (Array.isArray(msg.payload?.history)) {
              setHistory(msg.payload.history);
            }

            return;
          }

          if (msg.type === "alert" && msg.payload) {
            setLastAlert(msg.payload);
            setHistory((prev) => {
              const next = [msg.payload, ...prev.filter((x) => x.id !== msg.payload.id)];
              return next.slice(0, 100);
            });
          }
        } catch {}
      };

      ws.onclose = () => {
        setStatus("החיבור נותק, מנסה להתחבר מחדש...");
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        setStatus("שגיאת WebSocket");
        ws.close();
      };
    }

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      if (ws) {
        ws.close();
      }
    };
  }, []);

  useEffect(() => {
    if (!lastAlert?.id) return;
    if (lastPlayedAlertId.current === lastAlert.id) return;

    lastPlayedAlertId.current = lastAlert.id;
    playSoundsForAlert(lastAlert, soundEnabled);
  }, [lastAlert, soundEnabled]);

  async function enableSound() {
    try {
      const audio = new Audio(DEFAULT_BELL_SOUND);
      audio.muted = true;
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
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
          <p className="sub">התראות בלייב דרך WebSocket</p>
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
            <MapContainer
              center={[31.5, 34.9]}
              zoom={7}
              scrollWheelZoom={true}
              className="map"
            >
              <TileLayer
                attribution="© OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              <FitMapToMarkers points={alertPoints} />

              {alertPoints.map((point, index) => (
                <Marker
                  key={`${point.label}-${index}`}
                  position={[point.lat, point.lng]}
                >
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
                <p>
                  <strong>כותרת:</strong> {lastAlert.title}
                </p>

                <p>
                  <strong>תיאור:</strong> {lastAlert.desc || "ללא תיאור"}
                </p>

                <p>
                  <strong>קטגוריה:</strong> {lastAlert.category}
                </p>

                <p>
                  <strong>סוג קטגוריה:</strong> {lastAlert.categoryName}
                </p>

                <p>
                  <strong>זמן:</strong>{" "}
                  {new Date(lastAlert.receivedAt).toLocaleString("he-IL")}
                </p>

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
                    <div>
                      <strong>{item.title}</strong>
                    </div>

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