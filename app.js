'use strict';

// Fietsweer. De website verstuurt alleen opdrachten; de NodeMCU bepaalt
// het weeradvies en laat de fysieke servo bewegen.
const byId = (id) => document.getElementById(id);
const els = {
  loginScreen: byId('loginScreen'),
  dashboard: byId('dashboard'),
  loginForm: byId('loginForm'),
  loginMessage: byId('loginMessage'),
  loginButton: byId('loginButton'),
  signOut: byId('signOut'),
  stationState: byId('stationState'),
  stateText: byId('stateText'),
  updatedText: byId('updatedText'),
  adviceValue: byId('adviceValue'),
  adviceDetail: byId('adviceDetail'),
  adviceTime: byId('adviceTime'),
  adviceButton: byId('adviceButton'),
  commandMessage: byId('commandMessage'),
  tempValue: byId('tempValue'),
  rainValue: byId('rainValue'),
  windValue: byId('windValue'),
  humidityValue: byId('humidityValue'),
  manualButtons: [...document.querySelectorAll('[data-stand]')]
};

const settings = window.HOME_STATION_CONFIG || {};
let db = null;
let pollTimer = null;
let pending = null;
let signedIn = false;
let latest = null;
let readingInProgress = false;
const WEATHER_STALE_MS = 7 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 25 * 1000;
const LABELS = ['JA', 'JAS MEE', 'EERDER WEG', 'NEE'];

function text(id, value) { els[id].textContent = value; }
function number(value, digits = 1) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('nl-NL', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '—';
}
function normalizedNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function timeLabel(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}
function rainFromRaw(raw) {
  if (raw === null || raw === undefined) return '—';
  const n = Number(raw);
  if (!Number.isFinite(n)) return '—';
  return n > 3500 ? 'Droog' : n > 2000 ? 'Vochtig' : n > 1200 ? 'Nat' : 'Erg nat';
}
function message(value, kind = '') {
  text('commandMessage', value);
  els.commandMessage.dataset.kind = kind;
}
function setBusy(busy) {
  els.adviceButton.disabled = busy;
  for (const button of els.manualButtons) button.disabled = busy;
}
function setStationState(state, caption) {
  els.stationState.dataset.state = state;
  text('stateText', caption);
}
function renderWeather(record) {
  latest = record;
  const temp = normalizedNumber(record.temperature);
  const wind = normalizedNumber(record.wind_rps);
  const hum = normalizedNumber(record.humidity);
  text('tempValue', temp === null ? '—' : `${number(temp)} °C`);
  text('windValue', wind === null ? '—' : `${number(wind, 2)} r/s`);
  text('humidityValue', hum === null ? '—' : `${number(hum, 0)} %`);
  const rain = record.rain_status || rainFromRaw(record.rain_value);
  text('rainValue', typeof rain === 'string' && rain !== '—' ? rain.toLocaleLowerCase('nl-NL').replace(/^./, c => c.toLocaleUpperCase('nl-NL')) : rain);

  const label = typeof record.advice === 'string' && record.advice.trim() ? record.advice.trim() : 'Nog geen advies';
  text('adviceValue', label);
  text('adviceDetail', record.advice_detail || 'Vraag een advies aan op basis van de actuele meetgegevens.');
  const adviceAt = timeLabel(record.advice_updated_at);
  text('adviceTime', adviceAt ? `ADVIES OM ${adviceAt}` : '—');

  const updatedMs = record.updated_at ? new Date(record.updated_at).getTime() : NaN;
  const fresh = Number.isFinite(updatedMs) && Date.now() - updatedMs <= WEATHER_STALE_MS && Date.now() - updatedMs >= -60000;
  if (fresh) setStationState('fresh', 'Meetgegevens actueel');
  else setStationState('stale', 'Geen actuele metingen');
  const updated = timeLabel(record.updated_at);
  text('updatedText', updated ? `Laatste weerupdate: ${updated}` : 'Tijdstip laatste meting onbekend.');

  const stand = normalizedNumber(record.servo_stand);
  for (const button of els.manualButtons) {
    const current = stand !== null && stand === Number(button.dataset.stand);
    button.dataset.current = String(current);
    button.setAttribute('aria-pressed', String(current));
  }

  // Zo tonen we pas 'gelukt' als de NodeMCU de opdracht ook heeft verwerkt.
  if (pending) {
    if (record.last_command_id !== null && record.last_command_id !== undefined && String(record.last_command_id) === String(pending.id)) {
      message('Het rad heeft de opdracht uitgevoerd.', 'success');
      pending = null;
      setBusy(false);
    } else if (Date.now() - pending.started > COMMAND_TIMEOUT_MS) {
      message('Opdracht verstuurd, maar nog geen bevestiging van het Home Station.', 'error');
      pending = null;
      setBusy(false);
    }
  }
}
async function refreshWeather() {
  if (!db || !signedIn || readingInProgress) return;
  readingInProgress = true;
  try {
    const { data, error } = await db
      .from('home_station')
      .select('temperature,humidity,rain_value,rain_status,wind_rps,advice,advice_detail,updated_at,advice_updated_at,servo_stand,last_command_id')
      .eq('id', settings.stationId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Geen station met dit ID gevonden.');
    renderWeather(data);
  } catch (error) {
    if (pending && Date.now() - pending.started > COMMAND_TIMEOUT_MS) {
      message('Opdracht verstuurd, maar geen bevestiging ontvangen.', 'error');
      pending = null;
      setBusy(false);
    }
    setStationState('stale', 'Verbinding niet beschikbaar');
    text('updatedText', 'De weergegevens konden niet worden opgehaald.');
    if (!latest) message('Controleer de Supabase-tabel en de toegangsregels: ' + (error.message || 'onbekende fout'), 'error');
  } finally {
    readingInProgress = false;
  }
}
async function sendCommand(action, stand = null) {
  if (!db || !signedIn || pending) return;
  setBusy(true);
  message('Opdracht versturen...');
  try {
    const payload = {
      station_id: settings.stationId,
      action,
      stand: action === 'SET' ? stand : null
    };
    const { data, error } = await db
      .from('home_station_commands')
      .insert(payload)
      .select('id')
      .single();
    if (error) throw error;
    if (!data || data.id === undefined) throw new Error('Geen opdracht-ID ontvangen.');
    pending = { id: data.id, started: Date.now() };
    message('Opdracht verstuurd. Wachten op het rad...');
    await refreshWeather();
  } catch (error) {
    message('Versturen mislukt: ' + (error.message || 'onbekende fout'), 'error');
    setBusy(false);
  }
}
function showDashboard(visible) {
  signedIn = visible;
  els.loginScreen.hidden = visible;
  els.dashboard.hidden = !visible;
  els.signOut.hidden = !visible;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  pending = null;
  setBusy(false);
  if (visible) {
    refreshWeather();
    pollTimer = setInterval(refreshWeather, 3000);
  }
}

async function start() {
  // Alleen voor lokaal design bekijken. Geen echte opdrachten, en duidelijk
  // herkenbaar als voorbeeld. Gebruik: index.html?voorbeeld=1
  if (new URLSearchParams(location.search).has('voorbeeld')) {
    showDashboard(true);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    renderWeather({
      temperature: 17.4, humidity: 62, rain_value: 3970, rain_status: 'Droog',
      wind_rps: 0.26, advice: 'JAS MEE', advice_detail: 'WARME JAS',
      updated_at: new Date().toISOString(), advice_updated_at: new Date().toISOString(),
      servo_stand: 1, last_command_id: 0
    });
    setStationState('stale', 'Voorbeeld — geen live data');
    message('Voorbeeldweergave. De knoppen sturen niets naar je Home Station.');
    setBusy(true);
    els.signOut.hidden = true;
    return;
  }

  if (!window.supabase || !settings.supabaseUrl || !settings.supabasePublishableKey) {
    text('loginMessage', 'Supabase kon niet worden geladen. Controleer je internetverbinding en config.js.');
    return;
  }
  db = window.supabase.createClient(settings.supabaseUrl, settings.supabasePublishableKey);
  const { data, error } = await db.auth.getUser();
  if (!error && data?.user) showDashboard(true);
  else showDashboard(false);
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') showDashboard(false);
    else if (event === 'SIGNED_IN' && session?.user && !signedIn) showDashboard(true);
  });
}

els.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!db) return;
  els.loginButton.disabled = true;
  text('loginMessage', 'Inloggen...');
  try {
    const email = byId('email').value.trim();
    const password = byId('password').value;
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    byId('password').value = '';
    text('loginMessage', '');
    showDashboard(true);
  } catch (_error) {
    text('loginMessage', 'Inloggen niet gelukt. Controleer je gegevens.');
  } finally {
    els.loginButton.disabled = false;
  }
});
els.signOut.addEventListener('click', async () => {
  if (!db) return;
  await db.auth.signOut();
  showDashboard(false);
});
els.adviceButton.addEventListener('click', () => sendCommand('ADVICE'));
for (const button of els.manualButtons) {
  button.addEventListener('click', () => sendCommand('SET', Number(button.dataset.stand)));
}
start();
