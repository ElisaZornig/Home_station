const SUPABASE_URL = "https://epsbbagblmepwfszkjif.supabase.co";
const SUPABASE_KEY = "sb_publishable_ckPCB9UVM9DH_yG6CzwEqQ_TxKzDkti";

const endpoint = `${SUPABASE_URL}/rest/v1/home_station?id=eq.1&select=*`;

const elements = {
  temperature: document.getElementById("temperature"),
  humidity: document.getElementById("humidity"),
  rainStatus: document.getElementById("rainStatus"),
  wind: document.getElementById("wind"),
  advice: document.getElementById("advice"),
  adviceDetail: document.getElementById("adviceDetail"),
  updatedAt: document.getElementById("updatedAt"),
  adviceButton: document.getElementById("adviceButton"),
  requestStatus: document.getElementById("requestStatus"),
  connectionBadge: document.getElementById("connectionBadge"),
  connectionText: document.getElementById("connectionText"),
  adviceIcon: document.getElementById("adviceIcon")
};

const headers = {
  apikey: SUPABASE_KEY,
  "Content-Type": "application/json"
};

function setConnection(isOnline, text) {
  elements.connectionBadge.classList.toggle("online", isOnline);
  elements.connectionBadge.classList.toggle("offline", !isOnline);
  elements.connectionText.textContent = text;
}

function adviceIcon(advice = "") {
  const value = advice.toUpperCase();

  if (value.includes("NEE")) return "🚫";
  if (value.includes("EERDER")) return "💨";
  if (value.includes("JAS")) return "🧥";
  if (value === "JA") return "🚲";

  return "🚲";
}

function formatTime(value) {
  if (!value) return "--";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "--";

  return new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit"
  }).format(date);
}

function updateScreen(data) {
  elements.temperature.textContent =
    data.temperature == null ? "--" : Number(data.temperature).toFixed(1);

  elements.humidity.textContent =
    data.humidity == null ? "--" : Math.round(Number(data.humidity));

  elements.rainStatus.textContent =
    data.rain_status || "--";

  elements.wind.textContent =
    data.wind_rps == null ? "--" : Number(data.wind_rps).toFixed(2);

  elements.advice.textContent =
    data.advice || "Nog geen advies";

  elements.adviceDetail.textContent =
    data.advice_detail || "Druk op de knop om een nieuw advies te vragen.";

  elements.adviceIcon.textContent =
    adviceIcon(data.advice);

  elements.updatedAt.textContent =
    formatTime(data.updated_at);
}

async function loadStation() {
  try {
    const response = await fetch(endpoint, { headers });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const rows = await response.json();
    const data = rows[0];

    if (!data) {
      throw new Error("Geen Home Station-rij gevonden");
    }

    updateScreen(data);
    setConnection(true, "online");

    return data;
  } catch (error) {
    console.error(error);
    setConnection(false, "offline");
    return null;
  }
}

async function requestAdvice() {
  elements.adviceButton.disabled = true;
  elements.requestStatus.textContent = "Advies aangevraagd...";

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/home_station?id=eq.1`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          advice_requested: true
        })
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    elements.requestStatus.textContent =
      "Verzoek verstuurd naar Home Station.";

    // De NodeMCU gaat dit straks oppakken.
    // We verversen tijdelijk wat sneller om het nieuwe advies te zien.
    const start = Date.now();

    const interval = setInterval(async () => {
      const data = await loadStation();

      if (data && data.advice_requested === false) {
        clearInterval(interval);
        elements.requestStatus.textContent = "Nieuw advies ontvangen.";
        elements.adviceButton.disabled = false;

        setTimeout(() => {
          elements.requestStatus.textContent = "";
        }, 2500);

        return;
      }

      if (Date.now() - start > 20000) {
        clearInterval(interval);
        elements.requestStatus.textContent =
          "Verzoek staat klaar. Home Station heeft nog niet gereageerd.";
        elements.adviceButton.disabled = false;
      }
    }, 1500);
  } catch (error) {
    console.error(error);
    elements.requestStatus.textContent =
      "Kon geen advies aanvragen.";
    elements.adviceButton.disabled = false;
  }
}

elements.adviceButton.addEventListener("click", requestAdvice);

// Meteen laden en daarna rustig verversen.
loadStation();
setInterval(loadStation, 15000);
