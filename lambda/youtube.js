'use strict';
/*
 * YouTube full screen: the skill starts web/youtube/index.html as a web app (Alexa.Presentation.HTML) and fetches the
 * video lists for it from the YouTube Data API v3, so the API key stays in the skill and never reaches the page.
 * Quota (10,000 units a day): a chart costs 1 unit, a search 100 plus 1 for the durations.
 */
const fs = require('node:fs');
const path = require('node:path');
const { fetchImplStandaard } = require('./bronnen');

const API = 'https://www.googleapis.com/youtube/v3';
const REGIO = 'NL';
const AANTAL = 24;

/** YouTube categories that have a chart in the Netherlands; the page shows them as chips. */
const CATEGORIEEN = [
  { id: '', naam: 'Populair' },
  { id: '10', naam: 'Muziek' },
  { id: '20', naam: 'Gaming' },
  { id: '17', naam: 'Sport' },
  { id: '25', naam: 'Nieuws' },
  { id: '24', naam: 'Entertainment' },
];

/** API key: env YOUTUBE_KEY, else youtubeKey in credentials.json (gitignored). */
function sleutel() {
  if (process.env.YOUTUBE_KEY) return process.env.YOUTUBE_KEY;
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'credentials.json'), 'utf8')).youtubeKey || '';
  } catch {
    return '';
  }
}

/** Search snippets come with HTML entities in the title ("Rock &amp; Roll"). */
function ontsleutel(tekst) {
  return String(tekst || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** ISO 8601 duration (PT1H2M3S) as 1:02:03 or 2:03; live streams (P0D) and unknown give ''. */
function duur(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''));
  if (!m || (!m[1] && !m[2] && !m[3])) return '';
  const [u, min, s] = [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0)];
  const ss = String(s).padStart(2, '0');
  return u ? `${u}:${String(min).padStart(2, '0')}:${ss}` : `${min}:${ss}`;
}

/** One videos.list item as what the page needs; null when the video may not be embedded. */
function alsItem(v) {
  if (!v || !v.id || (v.status && v.status.embeddable === false)) return null;
  const sn = v.snippet || {};
  const th = sn.thumbnails || {};
  const live = sn.liveBroadcastContent === 'live';
  return {
    id: v.id,
    titel: ontsleutel(sn.title),
    kanaal: ontsleutel(sn.channelTitle),
    thumb: (th.medium || th.high || th.default || {}).url || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    duur: live ? 'LIVE' : duur(v.contentDetails && v.contentDetails.duration),
  };
}

async function haal(url, fetchImpl) {
  const r = await fetchImpl(url);
  if (!r.ok) {
    let reden = '';
    try {
      const j = await r.json();
      reden = (j.error && (j.error.errors?.[0]?.reason || j.error.message)) || '';
    } catch {
      reden = '';
    }
    throw new Error(`YouTube ${r.status}${reden ? ` ${reden}` : ''}`);
  }
  return r.json();
}

function categorieNaam(id) {
  const c = CATEGORIEEN.find((x) => x.id === String(id || ''));
  return c ? c.naam : 'Populair';
}

/** Most popular videos in the Netherlands, optionally for one category. */
async function populair({ categorie = '', key = sleutel(), fetchImpl = fetchImplStandaard } = {}) {
  if (!key) throw new Error('Geen YouTube-sleutel');
  const q = new URLSearchParams({ part: 'snippet,contentDetails,status', chart: 'mostPopular', regionCode: REGIO, maxResults: String(AANTAL), key });
  if (categorie) q.set('videoCategoryId', String(categorie));
  const j = await haal(`${API}/videos?${q}`, fetchImpl);
  return { titel: categorie ? categorieNaam(categorie) : 'Populair in Nederland', categorie: String(categorie || ''), items: (j.items || []).map(alsItem).filter(Boolean) };
}

/** Search for embeddable videos, then one videos.list call for the durations. */
async function zoek(vraag, { key = sleutel(), fetchImpl = fetchImplStandaard } = {}) {
  if (!key) throw new Error('Geen YouTube-sleutel');
  const term = String(vraag || '').trim();
  if (!term) return { titel: 'Zoeken', zoekterm: '', items: [] };
  const q = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: String(AANTAL), regionCode: REGIO, q: term, key });
  const j = await haal(`${API}/search?${q}`, fetchImpl);
  const ids = (j.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
  if (!ids.length) return { titel: `Niets gevonden voor “${term}”`, zoekterm: term, items: [] };
  const d = await haal(`${API}/videos?${new URLSearchParams({ part: 'snippet,contentDetails,status', id: ids.join(','), key })}`, fetchImpl);
  const perId = new Map((d.items || []).map((v) => [v.id, v]));
  const items = ids.map((id) => alsItem(perId.get(id))).filter(Boolean);
  return { titel: `Resultaten voor “${term}”`, zoekterm: term, items };
}

module.exports = { CATEGORIEEN, sleutel, ontsleutel, duur, alsItem, populair, zoek };
