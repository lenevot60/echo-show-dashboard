import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yt = require('../youtube.js')

const video = (id, extra = {}) => ({
  id,
  snippet: { title: `Rock &amp; Roll &#39;${id}&#39;`, channelTitle: 'Kanaal', channelId: 'UCkanaal1234567890', publishedAt: '2026-10-20T10:00:00Z', description: 'Regel een\n\nregel twee', thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` } }, liveBroadcastContent: 'none' },
  contentDetails: { duration: 'PT4M5S' },
  status: { embeddable: true },
  statistics: { viewCount: '1234567' },
  ...extra,
})
const kanalen = { items: [{ id: 'UCkanaal1234567890', snippet: { thumbnails: { default: { url: 'https://yt3/avatar.jpg' } } } }] }

function nep(antwoorden) {
  const urls = []
  const fetchImpl = async (url) => {
    urls.push(url)
    const a = antwoorden.shift()
    return { ok: a.status === undefined, status: a.status || 200, json: async () => a.body ?? a }
  }
  return { urls, fetchImpl }
}

test('durations read like the YouTube player shows them', () => {
  assert.equal(yt.duur('PT4M5S'), '4:05')
  assert.equal(yt.duur('PT1H2M3S'), '1:02:03')
  assert.equal(yt.duur('PT45S'), '0:45')
  assert.equal(yt.duur('P0D'), '')
})

test('titles lose their HTML entities, and a video that may not be embedded is left out', () => {
  assert.equal(yt.alsItem(video('a')).titel, "Rock & Roll 'a'")
  assert.equal(yt.alsItem(video('b', { status: { embeddable: false } })), null)
  assert.equal(yt.alsItem(video('c', { snippet: { title: 'x', liveBroadcastContent: 'live' } })).duur, 'LIVE')
})

test('popular asks the chart for the Netherlands and the chosen category', async () => {
  const { urls, fetchImpl } = nep([{ items: [video('a'), video('b')] }, kanalen])
  const l = await yt.populair({ categorie: '10', key: 'K', fetchImpl })
  assert.equal(l.titel, 'Muziek')
  assert.equal(l.items.length, 2)
  assert.equal(l.items[0].weergaven, 1234567)
  assert.equal(l.items[0].beschrijving, 'Regel een regel twee')
  assert.equal(l.items[0].avatar, 'https://yt3/avatar.jpg')
  assert.equal(new URL(urls[1]).pathname, '/youtube/v3/channels')
  const u = new URL(urls[0])
  assert.equal(u.searchParams.get('chart'), 'mostPopular')
  assert.equal(u.searchParams.get('regionCode'), 'NL')
  assert.equal(u.searchParams.get('videoCategoryId'), '10')
})

test('search keeps the order of the results and adds the durations', async () => {
  const { urls, fetchImpl } = nep([
    { items: [{ id: { videoId: 'b' } }, { id: { videoId: 'a' } }] },
    { items: [video('a'), video('b')] },
    kanalen,
  ])
  const l = await yt.zoek('katten', { key: 'K', fetchImpl })
  assert.deepEqual(l.items.map((i) => i.id), ['b', 'a'])
  assert.equal(l.items[0].duur, '4:05')
  assert.equal(new URL(urls[0]).searchParams.get('videoEmbeddable'), 'true')
  assert.equal(new URL(urls[1]).searchParams.get('id'), 'b,a')
})

test('an API error carries its reason, and no key means no call', async () => {
  const { fetchImpl } = nep([{ status: 403, body: { error: { errors: [{ reason: 'quotaExceeded' }] } } }])
  await assert.rejects(yt.populair({ key: 'K', fetchImpl }), /403 quotaExceeded/)
  await assert.rejects(yt.zoek('x', { key: '', fetchImpl }), /Geen YouTube-sleutel/)
})

test('subscriptions: the newest uploads of all subscribed channels first, read with the token', async () => {
  const headers = []
  const antwoorden = {
    subscriptions: { items: [{ snippet: { resourceId: { channelId: 'UCaaa' } } }, { snippet: { resourceId: { channelId: 'UCbbb' } } }] },
    'UUaaa': { items: [{ contentDetails: { videoId: 'a1', videoPublishedAt: '2026-10-20T10:00:00Z' } }] },
    'UUbbb': { items: [{ contentDetails: { videoId: 'b1', videoPublishedAt: '2026-10-22T08:00:00Z' } }, { contentDetails: { videoId: 'b0', videoPublishedAt: '2026-10-01T08:00:00Z' } }] },
  }
  const fetchImpl = async (url, init) => {
    headers.push(init && init.headers && init.headers.Authorization)
    const u = new URL(url)
    const sleutel = u.pathname.endsWith('/subscriptions') ? 'subscriptions' : u.searchParams.get('playlistId')
    const body = u.pathname.endsWith('/videos') ? { items: u.searchParams.get('id').split(',').map((id) => video(id)) } : u.pathname.endsWith('/channels') ? kanalen : antwoorden[sleutel]
    return { ok: true, status: 200, json: async () => body }
  }
  const l = await yt.mijn('@abonnementen', 'TOKEN', { fetchImpl })
  assert.deepEqual(l.items.map((i) => i.id), ['b1', 'a1', 'b0'])
  assert.ok(headers.every((h) => h === 'Bearer TOKEN'))
})

test('playlists become cards that open the playlist; an expired token keeps its status', async () => {
  const { fetchImpl } = nep([{ items: [{ id: 'PL1', snippet: { title: 'Muziek &amp; meer', thumbnails: { medium: { url: 'https://i/p.jpg' } } }, contentDetails: { itemCount: 12 } }] }])
  const l = await yt.mijn('@afspeellijsten', 'T', { fetchImpl })
  assert.deepEqual(l.items[0], { soort: 'afspeellijst', id: 'PL1', titel: 'Muziek & meer', kanaal: '12 video’s', thumb: 'https://i/p.jpg', duur: '12' })
  const { fetchImpl: f401 } = nep([{ status: 401, body: { error: { message: 'Invalid Credentials' } } }])
  await assert.rejects(yt.mijn('@leuk', 'T', { fetchImpl: f401 }), (e) => e.status === 401)
})

test('a list that would not fit in one message loses its descriptions first, then items', () => {
  const groot = { titel: 'x', items: Array.from({ length: 40 }, (_, i) => ({ id: `v${i}`, titel: 'T'.repeat(400), beschrijving: 'B'.repeat(160) })) }
  const l = yt.beperk(groot)
  assert.ok(Buffer.byteLength(JSON.stringify(l)) <= 22000)
  assert.equal(l.items[0].beschrijving, undefined)
  const klein = { titel: 'x', items: [{ id: 'a', beschrijving: 'kort' }] }
  assert.equal(yt.beperk(klein), klein)
})

test('more from a channel reads its uploads playlist; a channel id that is not one is refused', async () => {
  const { urls, fetchImpl } = nep([{ items: [{ contentDetails: { videoId: 'a' } }] }, { items: [video('a')] }, kanalen])
  const l = await yt.kanaal('UCkanaal1234567890', { key: 'K', fetchImpl })
  assert.equal(new URL(urls[0]).searchParams.get('playlistId'), 'UUkanaal1234567890')
  assert.equal(l.titel, 'Meer van Kanaal')
  await assert.rejects(yt.kanaal('../x', { key: 'K', fetchImpl }), /Ongeldig/)
})

test('a long description is cut at a word with an ellipsis', () => {
  const lang = 'woord '.repeat(60)
  const b = yt.alsItem(video('a', { snippet: { ...video('a').snippet, description: lang } })).beschrijving
  assert.ok(b.length <= 160)
  assert.match(b, /woord…$/)
})
