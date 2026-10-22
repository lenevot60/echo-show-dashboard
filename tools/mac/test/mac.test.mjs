import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leesTranscript, vatSamen } from '../claude-chats.mjs'
import { kiesTaken } from '../herinneringen.mjs'
import { ical, instanties, vatAgendaSamen } from '../agenda.mjs'
import { decodeer, kaartUrl, seconden, berekenRoute, ROUTES_URL } from '../route.mjs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const bronnen = require('../../../lambda/bronnen.js')

test('transcript: last ai-title wins, an unanswered question counts as open', () => {
  const regels = [
    { type: 'ai-title', aiTitle: 'Oud' },
    { type: 'ai-title', aiTitle: 'Echo Show-dashboard' },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion' }] } },
  ].map((x) => JSON.stringify(x)).join('\n')
  assert.deepEqual(leesTranscript(regels), { titel: 'Echo Show-dashboard', vraagOpen: true })
  const beantwoord = regels + '\n' + JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'q1' }] } })
  assert.equal(leesTranscript(beantwoord).vraagOpen, false)
  assert.equal(leesTranscript('niet json\n').titel, null)
})

test('claude summary: questions first, then busy, then waiting; counts per kind', () => {
  const s = vatSamen([
    { titel: 'A', status: 'idle', statusUpdatedAt: 1 },
    { titel: 'B', status: 'busy', statusUpdatedAt: 2 },
    { titel: 'C', status: 'idle', vraagOpen: true, statusUpdatedAt: 3 },
  ])
  assert.deepEqual(s.lijst.map((x) => [x.titel, x.label]), [['C', 'wacht op antwoord'], ['B', 'bezig'], ['A', 'wacht op jou']])
  assert.equal(s.bezig, 1)
  assert.equal(s.wacht, 2)
  assert.equal(s.vragen, 1)
})

test('tasks: overdue and today first, undated unflagged tasks left out', () => {
  const nu = new Date('2026-10-22T08:00:00Z')
  const r = kiesTaken([
    { titel: 'Ooit', lijst: 'X', due: null, vlag: false, prio: 0 },
    { titel: 'Vandaag', lijst: 'X', due: '2026-10-22T13:00:00Z', heeftTijd: true },
    { titel: 'Gisteren', lijst: 'X', due: '2026-10-21T10:00:00Z' },
    { titel: 'Morgen', lijst: 'Y', due: '2026-10-23T10:00:00Z' },
    { titel: 'Belangrijk', lijst: 'X', due: null, prio: 1 },
  ], { nu })
  assert.deepEqual(r.lijst.map((t) => [t.titel, t.wanneer]), [['Gisteren', 'te laat'], ['Vandaag', 'vandaag 15:00'], ['Morgen', 'morgen'], ['Belangrijk', '']])
  assert.equal(kiesTaken([{ titel: 'Morgen', lijst: 'Y', due: '2026-10-23T10:00:00Z' }], { nu, lijsten: ['X'] }).open, 0)
})

test('agenda: recurring events expand, waste days are recognised, past items drop out', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:1', 'SUMMARY:Teamoverleg', 'LOCATION:Marisstraat 8\\, Sliedrecht',
    'DTSTART;TZID=Europe/Amsterdam:20261020T093000', 'DTEND;TZID=Europe/Amsterdam:20261020T103000', 'RRULE:FREQ=DAILY;COUNT=5', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:2', 'SUMMARY:GFT-container', 'DTSTART;VALUE=DATE:20261023', 'DTEND;VALUE=DATE:20261024', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:3', 'SUMMARY:Ontbijt', 'DTSTART:20261022T050000Z', 'DTEND:20261022T053000Z', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  const data = ical.sync.parseICS(ics)
  const nu = new Date('2026-10-22T06:00:00Z')
  const lijst = instanties(data, { van: new Date('2026-10-21T18:00:00Z'), tot: new Date('2026-10-23T22:00:00Z') })
  const rijen = vatAgendaSamen(lijst, { nu })
  assert.deepEqual(rijen.map((r) => [r.tijd, r.titel, r.soort]), [
    ['09:30', 'Teamoverleg', 'afspraak'],
    ['morgen', 'GFT-container', 'afval'],
    ['morgen 09:30', 'Teamoverleg', 'afspraak'],
  ])
  assert.equal(rijen[0].plek, 'Marisstraat 8, Sliedrecht')
})

test('route: durations, polyline decoding and the map URL', () => {
  assert.equal(seconden('2280s'), 2280)
  assert.equal(seconden('x'), null)
  assert.deepEqual(decodeer('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]])
  const url = kaartUrl({ key: 'SLEUTEL', polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' })
  assert.match(url, /^https:\/\/maps\.googleapis\.com\/maps\/api\/staticmap\?size=640x640&scale=2/)
  assert.match(url, /colorscheme=dark/)
  assert.match(url, /path=weight%3A8%7Ccolor%3A0xFFC531ff%7Cenc%3A/)
  assert.match(url, /markers=color%3Awhite%7C38\.5%2C-120\.2/)
  assert.match(url, /key=SLEUTEL$/)
})

test('route: computeRoutes request with live traffic and field mask', async () => {
  let gezien
  const fetchImpl = async (url, init) => {
    gezien = { url, init }
    return { ok: true, text: async () => JSON.stringify({ routes: [{ duration: '2280s', staticDuration: '1920s', distanceMeters: 41234, description: 'A4', polyline: { encodedPolyline: 'abc' } }] }) }
  }
  const r = await berekenRoute({ key: 'K', van: 'Nieuw-Vossemeer, Nederland', naar: 'Marisstraat 8, 3364 AZ Sliedrecht', fetchImpl })
  assert.equal(gezien.url, ROUTES_URL)
  assert.equal(gezien.init.headers['X-Goog-Api-Key'], 'K')
  assert.match(gezien.init.headers['X-Goog-FieldMask'], /routes\.duration,routes\.staticDuration/)
  const body = JSON.parse(gezien.init.body)
  assert.equal(body.routingPreference, 'TRAFFIC_AWARE')
  assert.equal(body.travelMode, 'DRIVE')
  assert.deepEqual(body.origin, { address: 'Nieuw-Vossemeer, Nederland' })
  assert.deepEqual(r, { minuten: 38, normaal: 32, vertraging: 6, km: 41.2, via: 'A4', polyline: 'abc' })
})

test('rain: Buienradar text to summary and bars', () => {
  const droog = bronnen.regenUitTekst('000|11:35\n000|11:40\n')
  assert.equal(droog.samenvatting, 'Droog komende 2 uur')
  const nat = bronnen.regenUitTekst('000|11:35\n077|11:40\n141|11:45\n')
  assert.equal(nat.samenvatting, 'Buien vanaf 11:40')
  assert.equal(nat.balken.length, 3)
  assert.equal(nat.balken[0], 0)
  assert.ok(nat.balken[2] > nat.balken[1])
  assert.equal(bronnen.regenUitTekst('onzin'), null)
})
