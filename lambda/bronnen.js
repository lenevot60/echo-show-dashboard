'use strict';
/*
 * Data sources and the Data Store push, shared by the Lambda (voice, taps, install) and tools/push.mjs (periodic).
 * Nothing here is specific to Alexa except pushNaarDataStore. Secrets come from environment variables or
 * credentials.json (gitignored); config.json holds the rest.
 */
const fs = require('node:fs');
const path = require('node:path');

const https = require('node:https');

/**
 * Alexa-hosted skills may still run on Node.js 16, which has no global fetch. This small replacement covers what
 * this module needs: GET/POST with headers and a text body, and a response with ok, status, text() and json().
 */
function fetchViaHttps(url, init = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: init.method || 'GET', headers: init.headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: async () => text,
          json: async () => JSON.parse(text),
        });
      });
    });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

const fetchImplStandaard = typeof fetch === 'function' ? fetch : fetchViaHttps;

const FEED_URL = 'https://data.buienradar.nl/2.0/feed/json';
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const NAMESPACE = 'dashboard';
const KEY = 'overzicht';

function leesJson(bestand, fallback) {
  try {
    return JSON.parse(fs.readFileSync(bestand, 'utf8'));
  } catch {
    return fallback;
  }
}

function config() {
  return leesJson(path.join(__dirname, 'config.json'), {});
}

/** Client id and secret of the skill (Developer Console > Tools > Permissions > Alexa Skill Messaging). */
function credentials() {
  const uitEnv = {
    clientId: process.env.ALEXA_CLIENT_ID || '',
    clientSecret: process.env.ALEXA_CLIENT_SECRET || '',
  };
  if (uitEnv.clientId && uitEnv.clientSecret) return uitEnv;
  const uitBestand = leesJson(path.join(__dirname, 'credentials.json'), {});
  return {
    clientId: uitBestand.clientId || uitEnv.clientId,
    clientSecret: uitBestand.clientSecret || uitEnv.clientSecret,
  };
}

const DAGEN = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

function dagNaam(isoDatum) {
  const d = new Date(isoDatum);
  return Number.isNaN(d.getTime()) ? '' : DAGEN[d.getDay()];
}

function formatTijd(datum) {
  return new Intl.DateTimeFormat('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Amsterdam',
  }).format(datum);
}

function rond(n) {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;
}

/** Picks one station and the first three forecast days out of the Buienradar feed. */
function weerUitFeed(feed, stationId) {
  const metingen = feed?.actual?.stationmeasurements ?? [];
  const s = metingen.find((m) => m.stationid === stationId) ?? null;
  const verwachting = (feed?.forecast?.fivedayforecast ?? []).slice(0, 3).map((d) => ({
    dag: dagNaam(d.day),
    min: d.mintemperature ?? null,
    max: d.maxtemperature ?? null,
    regenkans: d.rainChance ?? null,
    beschrijving: d.weatherdescription ?? '',
    iconUrl: d.fullIconUrl ?? d.iconurl ?? null,
  }));
  return {
    plaats: s ? String(s.stationname).replace(/^Meetstation /, '') : null,
    temperatuur: rond(s?.temperature),
    gevoel: rond(s?.feeltemperature),
    beschrijving: s?.weatherdescription ?? null,
    wind: s ? [s.winddirection, s.windspeedBft != null ? `${s.windspeedBft} Bft` : null].filter(Boolean).join(' ') : null,
    luchtvochtigheid: s?.humidity ?? null,
    iconUrl: s?.fullIconUrl ?? s?.iconurl ?? null,
    gemeten: s?.timestamp ?? null,
    verwachting,
    samenvatting: feed?.forecast?.weatherreport?.summary ?? null,
    bron: 'Buienradar',
  };
}

async function haalWeer(stationId, fetchImpl = fetchImplStandaard) {
  const r = await fetchImpl(FEED_URL);
  if (!r.ok) throw new Error(`Buienradar ${r.status}`);
  return weerUitFeed(await r.json(), stationId);
}

const RAIN_URL = 'https://gpsgadget.buienradar.nl/data/raintext';

/** Buienradar rain forecast for the next two hours at one spot: value|HH:MM per 5 minutes, value 0-255. */
function regenUitTekst(tekst) {
  const punten = String(tekst)
    .split(/\r?\n/)
    .map((r) => /^(\d{1,3})\|(\d{1,2}:\d{2})$/.exec(r.trim()))
    .filter(Boolean)
    .map((m) => {
      const waarde = Number(m[1]);
      const mm = waarde === 0 ? 0 : Math.pow(10, (waarde - 109) / 32);
      return { tijd: m[2].padStart(5, '0'), mm: Math.round(mm * 10) / 10 };
    });
  if (!punten.length) return null;
  const eerste = punten.find((p) => p.mm >= 0.1);
  const max = Math.max(...punten.map((p) => p.mm));
  return {
    samenvatting: eerste ? (punten[0].mm >= 0.1 ? 'Het regent nu' : `Buien vanaf ${eerste.tijd}`) : 'Droog komende 2 uur',
    balken: punten.map((p) => Math.round(Math.min(1, p.mm / 4) * 100)),
    max: Math.round(max * 10) / 10,
    van: punten[0].tijd,
    tot: punten[punten.length - 1].tijd,
  };
}

async function haalRegen(lat, lon, fetchImpl = fetchImplStandaard) {
  const r = await fetchImpl(`${RAIN_URL}?lat=${lat}&lon=${lon}`);
  if (!r.ok) throw new Error(`Buienradar regen ${r.status}`);
  return regenUitTekst(await r.text());
}

/** Short lines for the dashboard, from notities.json; strings or {titel, sub}. */
function notities() {
  const n = leesJson(path.join(__dirname, 'notities.json'), { items: [] });
  return (Array.isArray(n.items) ? n.items : [])
    .slice(0, 6)
    .map((x) => (typeof x === 'string' ? { titel: x, sub: '' } : { titel: x.titel ?? '', sub: x.sub ?? '' }))
    .filter((x) => x.titel);
}

/** Everything the widget and the full screen show. Never throws: a failing source becomes `fout`. */
async function verzamel({ fetchImpl = fetchImplStandaard, nu = new Date() } = {}) {
  const c = config();
  let weer = null;
  let fout = null;
  try {
    weer = await haalWeer(c.buienradarStationId, fetchImpl);
  } catch (e) {
    fout = `Weer niet opgehaald: ${e && e.message ? e.message : e}`;
  }
  let regen = null;
  if (c.plek && c.plek.lat != null) {
    try {
      regen = await haalRegen(c.plek.lat, c.plek.lon, fetchImpl);
    } catch (e) {
      fout = [fout, `Regen niet opgehaald: ${e && e.message ? e.message : e}`].filter(Boolean).join(' · ');
    }
  }
  const items = notities();
  return {
    titel: c.titel || 'Dashboard',
    regen,
    bijgewerkt: nu.toISOString(),
    bijgewerktTekst: formatTijd(nu),
    weer,
    items,
    aantalItems: items.length,
    web: c.webUrl ? { url: c.webUrl, titel: c.webTitel || 'Webdashboard' } : null,
    fout,
  };
}

async function lwaToken({ clientId, clientSecret }, fetchImpl = fetchImplStandaard) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'alexa::datastore',
  });
  const r = await fetchImpl(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`Login with Amazon ${r.status}`);
  return r.json();
}

/**
 * Puts the content object in the device data store of one user or up to 20 devices
 * (Data Store REST API, PUT_OBJECT; payload at most 16 KB, 1 MB per skill per device).
 */
async function pushNaarDataStore({ content, target, endpoint, creds, fetchImpl = fetchImplStandaard }) {
  if (!creds || !creds.clientId || !creds.clientSecret) throw new Error('Client id en secret ontbreken');
  const token = await lwaToken(creds, fetchImpl);
  const r = await fetchImpl(endpoint || config().datastoreEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `${token.token_type || 'Bearer'} ${token.access_token}`,
    },
    body: JSON.stringify({
      commands: [{ type: 'PUT_OBJECT', namespace: NAMESPACE, key: KEY, content }],
      target,
    }),
  });
  const tekst = await r.text();
  if (!r.ok) throw new Error(`Data Store ${r.status}: ${tekst.slice(0, 300)}`);
  return tekst ? JSON.parse(tekst) : {};
}

module.exports = {
  FEED_URL,
  LWA_TOKEN_URL,
  NAMESPACE,
  KEY,
  config,
  credentials,
  weerUitFeed,
  haalWeer,
  regenUitTekst,
  haalRegen,
  notities,
  verzamel,
  lwaToken,
  pushNaarDataStore,
  formatTijd,
  fetchViaHttps,
};
