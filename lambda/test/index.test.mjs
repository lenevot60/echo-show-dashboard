import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { buildSkill } = require('../index.js')

const stil = { log() {}, error() {} }
const content = { titel: 'Thuis', bijgewerktTekst: '20:05', weer: null, items: [], aantalItems: 0, web: { url: 'https://voorbeeld.nl/dash', titel: 'Web' }, fout: null }

function envelope(request, { apl = true, locale = 'nl-NL' } = {}) {
  return {
    version: '1.0',
    session: { new: true, sessionId: 's', application: { applicationId: 'a' }, user: { userId: 'amzn1.ask.account.TEST' } },
    context: {
      System: {
        application: { applicationId: 'a' },
        user: { userId: 'amzn1.ask.account.TEST' },
        device: { deviceId: 'amzn1.ask.device.D', supportedInterfaces: apl ? { 'Alexa.Presentation.APL': {} } : {} },
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
  assert.deepEqual(pm.packages, [{ id: 'dashboard-widget' }])
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
