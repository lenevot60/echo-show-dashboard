/*
 * Travel time with live traffic (Google Routes API, computeRoutes with TRAFFIC_AWARE, billed as "Pro") and a map
 * image of the route (Maps Static API, "Essentials"). The key is GOOGLE_MAPS_KEY in .env, restricted in Google Cloud to
 * these two APIs, with a daily cap. Results are cached on disk so the dashboard calls Google at most every few minutes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'
const VELDEN = 'routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.description'
const CACHE = join(homedir(), '.cache', 'echo-show-dashboard')

export function seconden(waarde) {
  const m = /^(\d+(?:\.\d+)?)s$/.exec(String(waarde || ''))
  return m ? Number(m[1]) : null
}

/** Google encoded polyline to [[lat, lng], ...]. */
export function decodeer(poly) {
  const punten = []
  let i = 0, lat = 0, lng = 0
  while (i < poly.length) {
    for (const as of [0, 1]) {
      let resultaat = 0, shift = 0, b
      do {
        b = poly.charCodeAt(i++) - 63
        resultaat |= (b & 0x1f) << shift
        shift += 5
      } while (b >= 0x20)
      const delta = resultaat & 1 ? ~(resultaat >> 1) : resultaat >> 1
      if (as === 0) lat += delta
      else lng += delta
    }
    punten.push([lat / 1e5, lng / 1e5])
  }
  return punten
}

export async function berekenRoute({ key, van, naar, fetchImpl = fetch }) {
  const r = await fetchImpl(ROUTES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': VELDEN },
    body: JSON.stringify({
      origin: { address: van },
      destination: { address: naar },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      computeAlternativeRoutes: false,
      languageCode: 'nl-NL',
      units: 'METRIC',
    }),
  })
  const tekst = await r.text()
  if (!r.ok) throw new Error(`Google Routes ${r.status}: ${tekst.slice(0, 200)}`)
  const route = JSON.parse(tekst).routes?.[0]
  if (!route) throw new Error('Google Routes: geen route gevonden')
  const met = seconden(route.duration)
  const zonder = seconden(route.staticDuration) ?? met
  return {
    minuten: Math.round(met / 60),
    normaal: Math.round(zonder / 60),
    vertraging: Math.max(0, Math.round((met - zonder) / 60)),
    km: Math.round((route.distanceMeters || 0) / 100) / 10,
    via: route.description || '',
    polyline: route.polyline?.encodedPolyline || '',
  }
}

/** URL of a 1280x1280 dark map with the route and both ends. */
export function kaartUrl({ key, polyline, maat = 640 }) {
  const p = decodeer(polyline)
  const start = p[0], eind = p[p.length - 1]
  const delen = [
    `size=${maat}x${maat}`,
    'scale=2',
    'maptype=roadmap',
    'colorscheme=dark',
    `path=${encodeURIComponent(`weight:8|color:0xFFC531ff|enc:${polyline}`)}`,
    `markers=${encodeURIComponent(`color:white|${start[0]},${start[1]}`)}`,
    `markers=${encodeURIComponent(`color:0xFFC531|${eind[0]},${eind[1]}`)}`,
    `key=${encodeURIComponent(key)}`,
  ]
  const url = `https://maps.googleapis.com/maps/api/staticmap?${delen.join('&')}`
  if (url.length > 16_000) throw new Error('kaart-URL te lang')
  return url
}

function leesCache(naam) {
  try {
    return JSON.parse(readFileSync(join(CACHE, `${naam}.json`), 'utf8'))
  } catch {
    return null
  }
}
function schrijfCache(naam, data) {
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true })
  writeFileSync(join(CACHE, `${naam}.json`), JSON.stringify(data))
}

const uurNL = (d) => Number(new Intl.DateTimeFormat('nl-NL', { hour: 'numeric', hour12: false, timeZone: 'Europe/Amsterdam' }).format(d))

/**
 * The commute: from cache when fresh or outside the hours set in config (routeUren), otherwise from Google.
 * Returns null without a key.
 */
export async function routeNaarWerk({ key, van, naar, uren = [6, 21], maxLeeftijdMin = 9, nu = new Date(), fetchImpl = fetch }) {
  if (!key) return null
  const cache = leesCache('werk')
  const vers = cache && cache.van === van && cache.naar === naar && nu - new Date(cache.tijd) < maxLeeftijdMin * 60_000
  const binnenUren = uurNL(nu) >= uren[0] && uurNL(nu) < uren[1]
  if (cache && cache.van === van && cache.naar === naar && (vers || !binnenUren)) return { ...cache.route, uitCache: true, tijd: cache.tijd }
  if (!binnenUren) return null
  const route = await berekenRoute({ key, van, naar, fetchImpl })
  const metKaart = { ...route, kaartUrl: kaartUrl({ key, polyline: route.polyline }) }
  delete metKaart.polyline
  schrijfCache('werk', { van, naar, tijd: nu.toISOString(), route: metKaart })
  return { ...metKaart, tijd: nu.toISOString() }
}

const uurMin = (d) => new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }).format(d)

/**
 * Departure advice for the next appointment with a place, in the coming 12 hours. Work (werkPatroon) uses the
 * commute; any other place gets its own route, cached for 30 minutes per place.
 */
export async function vertrekAdvies({ agenda, werkRoute, key, van, werkPatroon, buffer = 5, nu = new Date(), fetchImpl = fetch }) {
  const volgende = (agenda || []).find((a) => a.soort === 'afspraak' && !a.heleDag && a.plek && new Date(a.startIso) > nu && new Date(a.startIso) - nu < 12 * 3_600_000)
  if (!volgende) return null
  let minuten = null
  if (werkPatroon && new RegExp(werkPatroon, 'i').test(volgende.plek)) minuten = werkRoute?.minuten ?? null
  else if (key && !/^(teams|zoom|google meet|online|microsoft teams)/i.test(volgende.plek)) {
    const cache = leesCache('plekken') || {}
    const c = cache[volgende.plek]
    if (c && nu - new Date(c.tijd) < 30 * 60_000) minuten = c.minuten
    else {
      const r = await berekenRoute({ key, van, naar: volgende.plek, fetchImpl })
      minuten = r.minuten
      cache[volgende.plek] = { minuten, tijd: nu.toISOString() }
      schrijfCache('plekken', cache)
    }
  }
  if (minuten == null) return null
  const start = new Date(volgende.startIso)
  const vertrek = new Date(start.getTime() - (minuten + buffer) * 60_000)
  const teLaat = vertrek < nu
  return {
    tekst: teLaat ? `Vertrek nu voor ${volgende.titel} (${uurMin(start)})` : `Vertrek om ${uurMin(vertrek)} voor ${volgende.titel} (${uurMin(start)})`,
    vertrek: uurMin(vertrek),
    teLaat,
    minuten,
  }
}
