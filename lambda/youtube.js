'use strict';
/*
 * YouTube full screen: the skill starts web/youtube/index.html as a web app (Alexa.Presentation.HTML) and fetches the
 * video lists for it from the YouTube Data API v3, so the API key stays in the skill and never reaches the page.
 * Quota (10,000 units a day): a chart costs 1 unit, a search 100 plus 1 for the durations.
 * With a linked Google account (Alexa account linking, scope youtube.readonly) the skill also reads the user's own
 * subscriptions, liked videos and playlists. YouTube's API has no watch history, Watch Later or home feed.
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

async function haal(url, fetchImpl, token) {
  const r = await fetchImpl(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  if (!r.ok) {
    let reden = '';
    try {
      const j = await r.json();
      reden = (j.error && (j.error.errors?.[0]?.reason || j.error.message)) || '';
    } catch {
      reden = '';
    }
    const fout = new Error(`YouTube ${r.status}${reden ? ` ${reden}` : ''}`);
    fout.status = r.status;
    throw fout;
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

/** Chips for the own account; the page sends their id like a category. */
const ACCOUNT = [
  { id: '@abonnementen', naam: 'Abonnementen' },
  { id: '@leuk', naam: 'Leuk gevonden' },
  { id: '@afspeellijsten', naam: 'Afspeellijsten' },
];

/** videos.list for ids, in the order of ids, without the ones that may not be embedded. */
async function videosOpVolgorde(ids, token, fetchImpl) {
  if (!ids.length) return [];
  const d = await haal(`${API}/videos?${new URLSearchParams({ part: 'snippet,contentDetails,status', id: ids.slice(0, 50).join(',') })}`, fetchImpl, token);
  const perId = new Map((d.items || []).map((v) => [v.id, v]));
  return ids.map((id) => alsItem(perId.get(id))).filter(Boolean);
}

/** Runs fn over the list with at most n at a time (one call per subscribed channel). */
async function perGroep(lijst, n, fn) {
  const uit = [];
  for (let i = 0; i < lijst.length; i += n) uit.push(...(await Promise.all(lijst.slice(i, i + n).map(fn))));
  return uit;
}

/**
 * The newest videos of the subscribed channels: subscriptions (up to 150, by relevance), then the three latest
 * uploads per channel, newest first. About one quota unit per channel.
 */
async function abonnementen(token, fetchImpl) {
  const kanalen = [];
  let pagina = '';
  for (let i = 0; i < 3; i++) {
    const q = new URLSearchParams({ part: 'snippet', mine: 'true', maxResults: '50', order: 'relevance' });
    if (pagina) q.set('pageToken', pagina);
    const j = await haal(`${API}/subscriptions?${q}`, fetchImpl, token);
    for (const s of j.items || []) if (s.snippet && s.snippet.resourceId) kanalen.push(s.snippet.resourceId.channelId);
    pagina = j.nextPageToken;
    if (!pagina) break;
  }
  const nieuw = await perGroep(kanalen, 20, async (kanaal) => {
    try {
      const q = new URLSearchParams({ part: 'contentDetails', playlistId: `UU${kanaal.slice(2)}`, maxResults: '3' });
      const j = await haal(`${API}/playlistItems?${q}`, fetchImpl, token);
      return (j.items || []).map((i) => ({ id: i.contentDetails.videoId, wanneer: i.contentDetails.videoPublishedAt || '' }));
    } catch {
      return [];
    }
  });
  const ids = nieuw.flat().sort((a, b) => (a.wanneer < b.wanneer ? 1 : -1)).map((x) => x.id);
  return { titel: 'Abonnementen', categorie: '@abonnementen', items: await videosOpVolgorde([...new Set(ids)].slice(0, 24), token, fetchImpl) };
}

/** What the linked account reads: subscriptions, liked videos, the own playlists, or the videos of one playlist. */
async function mijn(soort, token, { afspeellijst = null, fetchImpl = fetchImplStandaard } = {}) {
  if (soort === '@abonnementen') return abonnementen(token, fetchImpl);
  if (soort === '@leuk') {
    const j = await haal(`${API}/videos?${new URLSearchParams({ part: 'snippet,contentDetails,status', myRating: 'like', maxResults: '24' })}`, fetchImpl, token);
    return { titel: 'Video’s die je leuk vindt', categorie: '@leuk', items: (j.items || []).map(alsItem).filter(Boolean) };
  }
  if (soort === '@afspeellijsten') {
    const j = await haal(`${API}/playlists?${new URLSearchParams({ part: 'snippet,contentDetails', mine: 'true', maxResults: '50' })}`, fetchImpl, token);
    const items = (j.items || []).map((p) => {
      const th = (p.snippet && p.snippet.thumbnails) || {};
      const n = (p.contentDetails && p.contentDetails.itemCount) || 0;
      return { soort: 'afspeellijst', id: p.id, titel: ontsleutel(p.snippet && p.snippet.title), kanaal: `${n} video’s`, thumb: (th.medium || th.high || th.default || {}).url || '', duur: String(n) };
    });
    return { titel: 'Afspeellijsten', categorie: '@afspeellijsten', items };
  }
  if (soort === '@afspeellijst' && afspeellijst) {
    const j = await haal(`${API}/playlistItems?${new URLSearchParams({ part: 'contentDetails', playlistId: afspeellijst.id, maxResults: '50' })}`, fetchImpl, token);
    const ids = (j.items || []).map((i) => i.contentDetails && i.contentDetails.videoId).filter(Boolean);
    return { titel: afspeellijst.titel || 'Afspeellijst', categorie: '@afspeellijsten', items: await videosOpVolgorde(ids, token, fetchImpl) };
  }
  throw new Error(`Onbekend onderdeel ${soort}`);
}

module.exports = { CATEGORIEEN, ACCOUNT, sleutel, ontsleutel, duur, alsItem, populair, zoek, mijn };
