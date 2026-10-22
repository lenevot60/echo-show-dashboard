import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const yt = require('../youtube.js')

const video = (id, extra = {}) => ({
  id,
  snippet: { title: `Rock &amp; Roll &#39;${id}&#39;`, channelTitle: 'Kanaal', thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` } }, liveBroadcastContent: 'none' },
  contentDetails: { duration: 'PT4M5S' },
  status: { embeddable: true },
  ...extra,
})

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
  const { urls, fetchImpl } = nep([{ items: [video('a'), video('b')] }])
  const l = await yt.populair({ categorie: '10', key: 'K', fetchImpl })
  assert.equal(l.titel, 'Muziek')
  assert.equal(l.items.length, 2)
  const u = new URL(urls[0])
  assert.equal(u.searchParams.get('chart'), 'mostPopular')
  assert.equal(u.searchParams.get('regionCode'), 'NL')
  assert.equal(u.searchParams.get('videoCategoryId'), '10')
})

test('search keeps the order of the results and adds the durations', async () => {
  const { urls, fetchImpl } = nep([
    { items: [{ id: { videoId: 'b' } }, { id: { videoId: 'a' } }] },
    { items: [video('a'), video('b')] },
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
