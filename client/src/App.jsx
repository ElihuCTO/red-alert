import { useEffect, useMemo, useState } from "react";
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


function normalizeCityName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .replace(/["']/g, "")
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
    } catch (error) {
      setStatus("שגיאת חיבור");
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, []);

  const alertPoints = useMemo(() => {
    if (!lastAlert?.areas?.length) return [];
    return lastAlert.areas
      .map((city) => findCoordsByCityName(city))
      .filter(Boolean);
  }, [lastAlert]);

  return (
    <div className="app" dir="rtl">
      <header className="header">
        <div>
          <h1>מפת אזעקות בזמן אמת</h1>
          <p className="sub">התראה אחרונה והיסטוריה מהמנוע שלך</p>
        </div>
        <div className="status">{status}</div>
      </header>

      <div className="layout">
        <section className="card map-card">
          <h2>מפת ישראל</h2>

          <div className="map-wrap">
            <MapContainer center={[31.5, 34.9]} zoom={7} scrollWheelZoom={true} className="map">
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
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