import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { buildSkill } = require('../index.js')

const stil = { log() {}, error() {} }
const content = { titel: 'Thuis', bijgewerktTekst: '20:05', weer: null, items: [], aantalItems: 0, web: { url: 'https://voorbeeld.nl/dash', titel: 'Web' }, fout: null }

function envelope(request, { apl = true, html = false, locale = 'nl-NL', attributes, token } = {}) {
  const supportedInterfaces = { ...(apl ? { 'Alexa.Presentation.APL': {} } : {}), ...(html ? { 'Alexa.Presentation.HTML': {} } : {}) }
  return {
    version: '1.0',
    session: { new: true, sessionId: 's', application: { applicationId: 'a' }, user: { userId: 'amzn1.ask.account.TEST' }, ...(attributes ? { attributes } : {}) },
    context: {
      System: {
        application: { applicationId: 'a' },
        user: { userId: 'amzn1.ask.account.TEST', ...(token ? { accessToken: token } : {}) },
        device: { deviceId: 'amzn1.ask.device.D', supportedInterfaces },
        apiEndpoint: 'https://api.eu.amazonalexa.com',
      },
    },
    request: { requestId: 'r', timestamp: '2026-10-20T18:05:00Z', locale, ...request },
  }
}

function maak(overrides = {}) {
  const pushes = []
  const skill = buildSkill({
    verzamel: async () => content,
    push: async (args) => {
      pushes.push(args)
      return { results: [] }
    },
    // Tests never read the real credentials.json; the env vars decide per test.
    credentials: () => ({ clientId: process.env.ALEXA_CLIENT_ID || '', clientSecret: process.env.ALEXA_CLIENT_SECRET || '' }),
    logger: stil,
    ...overrides,
  }).create()
  return { skill, pushes }
}

const directive = (res) => res.response.directives?.find((d) => d.type === 'Alexa.Presentation.APL.RenderDocument')

test('LaunchRequest shows the dashboard on a screen device', async () => {
  const { skill } = maak()
  const res = await skill.invoke(envelope({ type: 'LaunchRequest' }))
  assert.match(res.response.outputSpeech.ssml, /Hier is je dashboard/)
  const d = directive(res)
  assert.ok(d)
  assert.equal(d.token, 'dashboard')
  assert.equal(d.datasources.ds.titel, 'Thuis')
  // The screen stays: an undefined shouldEndSession keeps the session open on a screen device.
  assert.equal(res.response.shouldEndSession, undefined)
  assert.equal(d.datasources.ds.blijf, true)
})

test('LaunchRequest without a screen only speaks', async () => {
  const { skill } = maak()
  const res = await skill.invoke(envelope({ type: 'LaunchRequest' }, { apl: false }))
  assert.match(res.response.outputSpeech.ssml, /Echo met scherm/)
  assert.equal(directive(res), undefined)
})

test('English device gets English speech', async () => {
  const { skill } = maak()
  const res = await skill.invoke(envelope({ type: 'LaunchRequest' }, { locale: 'en-GB' }))
  assert.match(res.response.outputSpeech.ssml, /Here is your dashboard/)
})

test('UsagesInstalled pushes the content to the data store of this user', async () => {
  process.env.ALEXA_CLIENT_ID = 'id'
  process.env.ALEXA_CLIENT_SECRET = 'geheim'
  const { skill, pushes } = maak()
  const res = await skill.invoke(envelope({ type: 'Alexa.DataStore.PackageManager.UsagesInstalled', payload: { packageId: 'dashboard-widget', packageVersion: '1.0.0', usages: [{ instanceId: 'i', location: 'FAVORITE' }] } }))
  assert.equal(pushes.length, 1)
  assert.deepEqual(pushes[0].target, { type: 'USER', id: 'amzn1.ask.account.TEST' })
  assert.equal(pushes[0].content.titel, 'Thuis')
  assert.equal(pushes[0].creds.clientId, 'id')
  assert.equal(res.response.outputSpeech, undefined)
  delete process.env.ALEXA_CLIENT_ID
  delete process.env.ALEXA_CLIENT_SECRET
})

test('without credentials the refresh updates the screen but does not push', async () => {
  const { skill, pushes } = maak()
  const res = await skill.invoke(envelope({ type: 'IntentRequest', intent: { name: 'RefreshIntent' } }))
  assert.equal(pushes.length, 0)
  assert.match(res.response.outputSpeech.ssml, /Bijgewerkt/)
  assert.ok(directive(res))
})

test('a failing push does not break the answer', async () => {
  process.env.ALEXA_CLIENT_ID = 'id'
  process.env.ALEXA_CLIENT_SECRET = 'geheim'
  const { skill } = maak({ push: async () => { throw new Error('Data Store 403') } })
  const res = await skill.invoke(envelope({ type: 'IntentRequest', intent: { name: 'RefreshIntent' } }))
  assert.match(res.response.outputSpeech.ssml, /Bijgewerkt/)
  delete process.env.ALEXA_CLIENT_ID
  delete process.env.ALEXA_CLIENT_SECRET
})

test('a tap on the widget opens the full dashboard; a widget refresh renders nothing', async () => {
  const { skill } = maak()
  const open = await skill.invoke(envelope({ type: 'Alexa.Presentation.APL.UserEvent', token: 'w', arguments: ['openDashboard'] }))
  assert.ok(directive(open))
  const ververs = await skill.invoke(envelope({ type: 'Alexa.Presentation.APL.UserEvent', token: 'w', arguments: ['refresh', 'widget'] }))
  assert.equal(directive(ververs), undefined)
})

test('OpenWebIntent renders the dashboard with openWeb set, and explains when no url is configured', async () => {
  const { skill } = maak()
  const res = await skill.invoke(envelope({ type: 'IntentRequest', intent: { name: 'OpenWebIntent' } }))
  assert.equal(directive(res).datasources.ds.openWeb, true)
  const zonder = maak({ verzamel: async () => ({ ...content, web: null }) })
  const res2 = await zonder.skill.invoke(envelope({ type: 'IntentRequest', intent: { name: 'OpenWebIntent' } }))
  assert.match(res2.response.outputSpeech.ssml, /webUrl/)
})

test('ShowUserIdIntent puts the user id on a card and on the screen', async () => {
  const { skill } = maak()
  const res = await skill.invoke(envelope({ type: 'IntentRequest', intent: { name: 'ShowUserIdIntent' } }))
  assert.equal(res.response.card.content, 'amzn1.ask.account.TEST')
  assert.equal(directive(res).datasources.ds.gebruikersId, 'amzn1.ask.account.TEST')
})

test('help, stop and fallback answer in Dutch', async () => {
  const { skill } = maak()
  for (const [name, re] of [['AMAZON.HelpIntent', /toon het dashboard/], ['AMAZON.StopIntent', /Tot later/], ['AMAZON.FallbackIntent', /ken ik niet/]]) {
    const res = await skill.invoke(envelope({ type: 'IntentRequest', intent: { name } }))
    assert.match(res.response.outputSpeech.ssml, re)
  }
})

test('every JSON in the skill package parses and the widget binds the data store', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const { fileURLToPath } = require('node:url')
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const lees = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))
  const skill = lees('skill-package/skill.json')
  const pm = skill.manifest.apis.custom.interfaces.find((i) => i.type === 'ALEXA_DATASTORE_PACKAGEMANAGER')
  assert.deepEqual(pm.packages, [{ id: 'dashboard-widget' }, { id: 'youtube-widget' }])
  assert.ok(skill.manifest.apis.custom.interfaces.some((i) => i.type === 'ALEXA_PRESENTATION_HTML'))
  const yt = lees('skill-package/dataStorePackages/youtube-widget/documents/document.json')
  assert.deepEqual(yt.mainTemplate.items[0].onPress[0], { type: 'SendEvent', arguments: ['openYouTube'], flags: { interactionMode: 'STANDARD' } })
  assert.equal(lees('skill-package/dataStorePackages/youtube-widget/manifest.json').manifest.id, 'youtube-widget')
  for (const l of ['nl-NL', 'en-GB', 'en-US']) {
    const intents = lees(`skill-package/interactionModels/custom/${l}.json`).interactionModel.languageModel.intents
    assert.equal(intents.find((i) => i.name === 'SearchVideoIntent').slots[0].type, 'AMAZON.SearchQuery')
    assert.ok(intents.some((i) => i.name === 'OpenYouTubeIntent'))
  }
  const manifest = lees('skill-package/dataStorePackages/dashboard-widget/manifest.json')
  assert.equal(manifest.manifest.id, 'dashboard-widget')
  assert.equal(manifest.publishingInformation.locales['nl-NL'][0].targetViewport, 'WIDGET_M')
  const tpl = lees('skill-package/dataStorePackages/dashboard-widget/presentations/default.tpl')
  assert.equal(tpl.type, 'APL_PRESENTATION')
  const widget = lees(path.join('skill-package/dataStorePackages/dashboard-widget', tpl.documentUrl))
  assert.deepEqual(widget.settings.DataStore.dataBindings[0], { namespace: 'dashboard', key: 'overzicht', dataBindingName: 'ds', dataType: 'OBJECT' })
  assert.equal(widget.extensions[0].uri, 'alexaext:datastore:10')
  lees(path.join('skill-package/dataStorePackages/dashboard-widget', tpl.datasourceUrl))
  for (const l of ['nl-NL', 'en-GB']) assert.ok(lees(`skill-package/interactionModels/custom/${l}.json`).interactionModel.languageModel.invocationName)
  assert.equal(lees('lambda/apl/dashboard.json').mainTemplate.parameters[0], 'payload')
})

test('a keep-alive ping keeps the screen without speech, and redraws once the data is older than verversMinuten', async () => {
  const { skill } = maak()
  const vers = await skill.invoke(envelope({ type: 'Alexa.Presentation.APL.UserEvent', token: 'dashboard', arguments: ['blijf', new Date().toISOString()] }))
  assert.equal(vers.response.outputSpeech, undefined)
  assert.equal(vers.response.shouldEndSession, undefined)
  assert.equal(directive(vers), undefined)
  const oud = await skill.invoke(envelope({ type: 'Alexa.Presentation.APL.UserEvent', token: 'dashboard', arguments: ['blijf', '2026-01-01T00:00:00Z'] }))
  assert.ok(directive(oud))
  assert.equal(oud.response.shouldEndSession, undefined)
})

test('stop still closes the screen', async () => {
  const { skill } = maak()
  const res = await skill.invoke(envelope({ type: 'IntentRequest', intent: { name: 'AMAZON.StopIntent' } }))
  assert.equal(res.response.shouldEndSession, true)
})

test('the dashboard document pings on its own sequencer and asks for a longer idle time', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const { fileURLToPath } = require('node:url')
  const doc = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'apl', 'dashboard.json'), 'utf8'))
  assert.equal(doc.settings.idleTimeout, 120000)
  const top = doc.mainTemplate.items[0]
  const tick = top.handleTick[0]
  assert.equal(tick.minimumDelay, 25000)
  assert.equal(tick.commands[0].type, 'SendEvent')
  assert.equal(tick.commands[0].sequencer, 'blijf')
  assert.equal(tick.commands[0].arguments[0], 'blijf')
  assert.equal(doc.onMount, undefined)
})

test('the full screen reads the data store as md and falls back to what the skill sent', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const { fileURLToPath } = require('node:url')
  const doc = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'apl', 'dashboard.json'), 'utf8'))
  assert.equal(doc.extensions[0].uri, 'alexaext:datastore:10')
  assert.deepEqual(doc.settings.DataStore.dataBindings[0], { namespace: 'dashboard', key: 'overzicht', dataBindingName: 'md', dataType: 'OBJECT' })
  const d = doc.mainTemplate.items[0].bind.find((b) => b.name === 'd')
  assert.match(d.value, /md\.ts > payload\.ds\.ts - 1800000 \? md : payload\.ds/)
})

test('outside schermAan the screen closes once it has been up handmatigMinuten; inside it stays', async () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const { fileURLToPath } = require('node:url')
  const cfg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config.json'), 'utf8'))
  assert.deepEqual(cfg.schermAan, { van: '06:00', tot: '10:00' })
  const ping = (nu, minutenOpen) => {
    const { skill } = maak({ nu: () => nu })
    const gestart = String(nu.getTime() - minutenOpen * 60000)
    return skill.invoke(envelope({ type: 'Alexa.Presentation.APL.UserEvent', token: 'dashboard', arguments: ['blijf', nu.toISOString(), gestart] }))
  }
  // 22 Oct is still summer time: 05:30Z is 07:30 in Amsterdam, 12:00Z is 14:00.
  const binnen = await ping(new Date('2026-10-22T05:30:00Z'), 90)
  assert.equal(binnen.response.shouldEndSession, undefined)
  const buitenLang = await ping(new Date('2026-10-22T12:00:00Z'), 20)
  assert.equal(buitenLang.response.shouldEndSession, true)
  const buitenKort = await ping(new Date('2026-10-22T12:00:00Z'), 5)
  assert.equal(buitenKort.response.shouldEndSession, undefined)
})

test('a redraw keeps the original opening time, so the window rule still applies afterwards', async () => {
  const nu = new Date('2026-10-22T05:30:00Z')
  const { skill } = maak({ nu: () => nu })
  const res = await skill.invoke(envelope({ type: 'Alexa.Presentation.APL.UserEvent', token: 'dashboard', arguments: ['blijf', '2026-01-01T00:00:00Z', '1792640000000'] }))
  assert.equal(directive(res).datasources.ds.gestart, 1792640000000)
  const doc = JSON.parse(require('node:fs').readFileSync(new URL('../apl/dashboard.json', import.meta.url), 'utf8'))
  assert.deepEqual(doc.mainTemplate.items[0].handleTick[0].commands[0].arguments, ['blijf', '${payload.ds.bijgewerkt}', '${payload.ds.gestart}'])
})

const opslagMet = (mac) => ({ lees: async () => mac })

test('the Mac part from the gist is merged into the full screen while it is at most 30 minutes old', async () => {
  const nu = new Date('2026-10-22T06:00:00Z')
  const mac = { ts: nu.getTime() - 5 * 60000, taken: [{ titel: 'Offerte', wanneer: 'vandaag' }], aantalTaken: 1, claude: { bezig: 2, wacht: 1, vragen: 0, lijst: [] }, titel: 'mag niet over' }
  const { skill } = maak({ opslag: opslagMet(mac), nu: () => nu })
  const ds = directive(await skill.invoke(envelope({ type: 'LaunchRequest' }))).datasources.ds
  assert.equal(ds.aantalTaken, 1)
  assert.equal(ds.claude.bezig, 2)
  assert.equal(ds.titel, 'Thuis', 'only the Mac fields are taken over')
})

test('Mac data older than 30 minutes is left out, and a failing gist does not break the screen', async () => {
  const nu = new Date('2026-10-22T06:00:00Z')
  const oud = maak({ opslag: opslagMet({ ts: nu.getTime() - 31 * 60000, aantalTaken: 3 }), nu: () => nu })
  assert.equal(directive(await oud.skill.invoke(envelope({ type: 'LaunchRequest' }))).datasources.ds.aantalTaken, undefined)
  const kapot = maak({ opslag: { lees: async () => { throw new Error('Gist 500') } }, nu: () => nu })
  const ds = directive(await kapot.skill.invoke(envelope({ type: 'LaunchRequest' }))).datasources.ds
  assert.equal(ds.titel, 'Thuis')
})

const lijst = { titel: 'Populair in Nederland', categorie: '', items: [{ id: 'abc', titel: 'Video', kanaal: 'Kanaal', thumb: 'https://i/t.jpg', duur: '3:15' }] }
function metYouTube(extra = {}) {
  const vragen = []
  const { skill } = maak({
    youtube: {
      sleutel: () => 'SLEUTEL',
      populair: async (o) => { vragen.push(['populair', o.categorie]); return lijst },
      zoek: async (q) => { vragen.push(['zoek', q]); return { ...lijst, titel: `Resultaten voor “${q}”`, zoekterm: q } },
      mijn: async (soort, token, o) => { vragen.push(['mijn', soort, token, o.afspeellijst && o.afspeellijst.id]); return { ...lijst, titel: soort, categorie: soort } },
      kanaal: async (id, o) => { vragen.push(['kanaal', id, o.token]); return { titel: 'Meer van Kanaal', kanaalId: id, items: lijst.items } },
      ...extra,
    },
  })
  return { skill, vragen }
}
const htmlDirective = (res, type) => res.response.directives?.find((d) => d.type === type)

test('a tap on the YouTube widget starts the web app full screen with the popular list', async () => {
  const { skill, vragen } = metYouTube()
  const res = await skill.invoke(envelope({ type: 'Alexa.Presentation.APL.UserEvent', arguments: ['openYouTube'] }, { html: true }))
  const d = htmlDirective(res, 'Alexa.Presentation.HTML.Start')
  assert.ok(d)
  assert.match(d.request.uri, /^https:\/\/.+\/youtube\/$/)
  assert.equal(d.request.method, 'GET')
  assert.equal(d.configuration.timeoutInSeconds, 300)
  assert.equal(d.data.lijst.items[0].id, 'abc')
  assert.ok(d.data.categorieen.length > 1)
  assert.deepEqual(vragen, [['populair', '']])
  assert.equal(res.response.shouldEndSession, undefined)
  assert.equal(res.sessionAttributes.youtube, true)
})

test('a device without web apps hears why instead of getting a directive it cannot run', async () => {
  const { skill } = metYouTube()
  const res = await skill.invoke(envelope({ type: 'IntentRequest', intent: { name: 'OpenYouTubeIntent' } }, { html: false }))
  assert.match(res.response.outputSpeech.ssml, /niet over het hele scherm/)
  assert.equal(htmlDirective(res, 'Alexa.Presentation.HTML.Start'), undefined)
})

test('a spoken search while YouTube is on screen sends the results to the page instead of restarting it', async () => {
  const { skill, vragen } = metYouTube()
  const intent = { name: 'SearchVideoIntent', slots: { query: { name: 'query', value: 'katten' } } }
  const res = await skill.invoke(envelope({ type: 'IntentRequest', intent }, { html: true, attributes: { youtube: true } }))
  assert.equal(htmlDirective(res, 'Alexa.Presentation.HTML.Start'), undefined)
  const m = htmlDirective(res, 'Alexa.Presentation.HTML.HandleMessage')
  assert.equal(m.message.type, 'lijst')
  assert.equal(m.message.lijst.zoekterm, 'katten')
  assert.deepEqual(vragen, [['zoek', 'katten']])
})

test('messages from the page: search, category and a silent keep-alive ping', async () => {
  const { skill, vragen } = metYouTube()
  const bericht = (message) => skill.invoke(envelope({ type: 'Alexa.Presentation.HTML.Message', message }, { html: true, attributes: { youtube: true } }))
  const zoek = await bericht({ type: 'zoek', zoekterm: 'treinen' })
  assert.equal(htmlDirective(zoek, 'Alexa.Presentation.HTML.HandleMessage').message.lijst.zoekterm, 'treinen')
  await bericht({ type: 'categorie', categorie: '10' })
  const ping = await bericht({ type: 'blijf' })
  assert.equal(ping.response.directives, undefined)
  assert.equal(ping.response.outputSpeech, undefined)
  assert.equal(ping.response.shouldEndSession, undefined)
  assert.deepEqual(vragen, [['zoek', 'treinen'], ['populair', '10']])
})

test('a failing YouTube call still opens the page, with the error in the list', async () => {
  const { skill } = metYouTube({ populair: async () => { throw new Error('YouTube 403 quotaExceeded') } })
  const res = await skill.invoke(envelope({ type: 'IntentRequest', intent: { name: 'OpenYouTubeIntent' } }, { html: true }))
  const d = htmlDirective(res, 'Alexa.Presentation.HTML.Start')
  assert.deepEqual(d.data.lijst.items, [])
  assert.match(d.data.lijst.fout, /quotaExceeded/)
})

test('with a linked account YouTube still opens on Start (popular), and tells the page it is linked', async () => {
  const { skill, vragen } = metYouTube()
  const res = await skill.invoke(envelope({ type: 'Alexa.Presentation.APL.UserEvent', arguments: ['openYouTube'] }, { html: true, token: 'TOKEN' }))
  const d = htmlDirective(res, 'Alexa.Presentation.HTML.Start')
  assert.equal(d.data.gekoppeld, true)
  assert.equal(d.data.lijst.titel, 'Populair in Nederland')
  assert.deepEqual(vragen, [['populair', '']])
})

test('answers carry the request number back, and "more from this channel" uses the token when there is one', async () => {
  const { skill, vragen } = metYouTube()
  const zoek = await skill.invoke(envelope({ type: 'Alexa.Presentation.HTML.Message', message: { type: 'zoek', zoekterm: 'x', verzoek: 7 } }, { html: true, attributes: { youtube: true } }))
  assert.equal(htmlDirective(zoek, 'Alexa.Presentation.HTML.HandleMessage').message.verzoek, 7)
  const res = await skill.invoke(envelope({ type: 'Alexa.Presentation.HTML.Message', message: { type: 'kanaal', kanaalId: 'UCabc', verzoek: 8 } }, { html: true, attributes: { youtube: true }, token: 'TOKEN' }))
  const m = htmlDirective(res, 'Alexa.Presentation.HTML.HandleMessage').message
  assert.equal(m.type, 'kanaal')
  assert.equal(m.kanaalId, 'UCabc')
  assert.equal(m.verzoek, 8)
  assert.equal(m.lijst.titel, 'Meer van Kanaal')
  assert.deepEqual(vragen.at(-1), ['kanaal', 'UCabc', 'TOKEN'])
})

test('without a linked account an account chip explains how to link and puts a link card in the Alexa app', async () => {
  const { skill, vragen } = metYouTube()
  const res = await skill.invoke(envelope({ type: 'Alexa.Presentation.HTML.Message', message: { type: 'categorie', categorie: '@leuk' } }, { html: true, attributes: { youtube: true } }))
  const m = htmlDirective(res, 'Alexa.Presentation.HTML.HandleMessage')
  assert.match(m.message.lijst.melding, /Account koppelen/)
  assert.equal(res.response.card.type, 'LinkAccount')
  assert.deepEqual(vragen, [])
})

test('a playlist tapped on the page is read with the token; an expired link asks to link again', async () => {
  const { skill, vragen } = metYouTube()
  const bericht = { type: 'Alexa.Presentation.HTML.Message', message: { type: 'afspeellijst', id: 'PL1', titel: 'Muziek' } }
  await skill.invoke(envelope(bericht, { html: true, attributes: { youtube: true }, token: 'TOKEN' }))
  assert.deepEqual(vragen, [['mijn', '@afspeellijst', 'TOKEN', 'PL1']])
  const verlopen = Object.assign(new Error('YouTube 401'), { status: 401 })
  const { skill: s2 } = metYouTube({ mijn: async () => { throw verlopen } })
  const res = await s2.invoke(envelope({ type: 'Alexa.Presentation.HTML.Message', message: { type: 'categorie', categorie: '@abonnementen' } }, { html: true, attributes: { youtube: true }, token: 'OUD' }))
  assert.match(htmlDirective(res, 'Alexa.Presentation.HTML.HandleMessage').message.lijst.melding, /opnieuw/)
  assert.equal(res.response.card.type, 'LinkAccount')
})
