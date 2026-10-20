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
  assert.equal(res.response.shouldEndSession, true)
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
