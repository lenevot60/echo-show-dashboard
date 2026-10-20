import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const bronnen = require('../bronnen.js')

const feed = {
  actual: {
    stationmeasurements: [
      { stationid: 6344, stationname: 'Meetstation Rotterdam', temperature: 12.4, feeltemperature: 10.1, weatherdescription: 'Zwaar bewolkt', winddirection: 'ZW', windspeedBft: 4, humidity: 81, iconurl: 'https://i/30.png', fullIconUrl: 'https://i/96.png', timestamp: '2026-10-20T19:50:00' },
      { stationid: 6356, stationname: 'Meetstation Herwijnen', temperature: 11.0 },
    ],
  },
  forecast: {
    weatherreport: { summary: 'Wisselvallig' },
    fivedayforecast: [
      { day: '2026-10-21T00:00:00', mintemperature: '8', maxtemperature: '14', rainChance: 60, weatherdescription: 'Buien', iconurl: 'https://i/a.png' },
      { day: '2026-10-22T00:00:00', mintemperature: '7', maxtemperature: '13', rainChance: 20 },
      { day: '2026-10-23T00:00:00', mintemperature: '6', maxtemperature: '12', rainChance: 10 },
      { day: '2026-10-24T00:00:00', mintemperature: '5', maxtemperature: '11', rainChance: 0 },
    ],
  },
}

test('picks the station and three forecast days from the Buienradar feed', () => {
  const w = bronnen.weerUitFeed(feed, 6344)
  assert.equal(w.plaats, 'Rotterdam')
  assert.equal(w.temperatuur, 12)
  assert.equal(w.gevoel, 10)
  assert.equal(w.wind, 'ZW 4 Bft')
  assert.equal(w.iconUrl, 'https://i/96.png')
  assert.equal(w.verwachting.length, 3)
  assert.deepEqual(w.verwachting[0], { dag: 'wo', min: '8', max: '14', regenkans: 60, beschrijving: 'Buien', iconUrl: 'https://i/a.png' })
  assert.equal(w.samenvatting, 'Wisselvallig')
})

test('an unknown station gives empty weather fields instead of an error', () => {
  const w = bronnen.weerUitFeed(feed, 1)
  assert.equal(w.plaats, null)
  assert.equal(w.temperatuur, null)
  assert.equal(w.verwachting.length, 3)
})

test('verzamel never throws: a failing feed becomes `fout`', async () => {
  const content = await bronnen.verzamel({ fetchImpl: async () => ({ ok: false, status: 503 }), nu: new Date('2026-10-20T18:05:00Z') })
  assert.equal(content.weer, null)
  assert.match(content.fout, /503/)
  assert.equal(content.bijgewerktTekst, '20:05')
  assert.ok(Array.isArray(content.items))
  assert.equal(content.aantalItems, content.items.length)
})

test('verzamel returns the weather when the feed answers', async () => {
  const content = await bronnen.verzamel({ fetchImpl: async () => ({ ok: true, json: async () => feed }) })
  assert.equal(content.fout, null)
  assert.equal(content.weer.beschrijving, 'Zwaar bewolkt')
  assert.ok(content.titel)
})

test('pushNaarDataStore gets a token with the datastore scope and sends one PUT_OBJECT to the target', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    if (url === bronnen.LWA_TOKEN_URL) return { ok: true, json: async () => ({ access_token: 'tok', token_type: 'bearer' }) }
    return { ok: true, text: async () => JSON.stringify({ results: [{ deviceId: 'amzn1.ask.device.1', type: 'SUCCESS' }] }) }
  }
  const result = await bronnen.pushNaarDataStore({
    content: { titel: 'x' },
    target: { type: 'USER', id: 'amzn1.ask.account.X' },
    endpoint: 'https://api.eu.amazonalexa.com/v1/datastore/commands',
    creds: { clientId: 'id', clientSecret: 'geheim' },
    fetchImpl,
  })
  assert.equal(result.results[0].type, 'SUCCESS')
  assert.equal(calls.length, 2)
  const token = new URLSearchParams(calls[0].init.body)
  assert.equal(token.get('grant_type'), 'client_credentials')
  assert.equal(token.get('scope'), 'alexa::datastore')
  assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded')
  assert.equal(calls[1].url, 'https://api.eu.amazonalexa.com/v1/datastore/commands')
  assert.equal(calls[1].init.headers.Authorization, 'bearer tok')
  const body = JSON.parse(calls[1].init.body)
  assert.deepEqual(body.commands, [{ type: 'PUT_OBJECT', namespace: 'dashboard', key: 'overzicht', content: { titel: 'x' } }])
  assert.deepEqual(body.target, { type: 'USER', id: 'amzn1.ask.account.X' })
})

test('pushNaarDataStore refuses to run without credentials', async () => {
  await assert.rejects(() => bronnen.pushNaarDataStore({ content: {}, target: {}, creds: {} }), /ontbreken/)
})
