#!/usr/bin/env node
/*
 * Sends a request envelope through Test > Manual JSON and prints the essentials of the skill's answer.
 *   node tools/console/manual-json.mjs launch|tik|request en-US [arguments | '<request json>'] [--html] [--attr='<json>']
 * --html adds Alexa.Presentation.HTML to the device's interfaces; --attr sets session attributes.
 */
import { readFileSync } from 'node:fs'
import { connect } from './cdp.mjs'
const [soort = 'launch', locale = 'en-US', ...alles] = process.argv.slice(2)
const html = alles.includes('--html')
const attr = alles.find((a) => a.startsWith('--attr='))
const rest = alles.filter((a) => !a.startsWith('--'))
const skillId = readFileSync('tools/console/skill-id.txt', 'utf8').trim()
const { browser, page } = await connect()
const loc = locale.replace('-', '_')
// A fresh page load answers the first Submit with nothing; reuse an open test page of the same locale.
if (!page.url().includes(`/ask/test/${skillId}/development/${loc}/`)) {
  await page.goto(`https://developer.amazon.com/alexa/console/ask/test/${skillId}/development/${loc}/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(7000)
}
const got = page.getByRole('button', { name: 'Got it' }).first(); if (await got.count()) await got.click({ force: true }).catch(() => {})
await page.getByText('Manual JSON', { exact: true }).first().click({ force: true })
await page.waitForTimeout(2500)
const basis = (request) => ({
  version: '1.0',
  session: { new: soort === 'launch', sessionId: 'amzn1.echo-api.session.test', application: { applicationId: skillId }, user: { userId: 'amzn1.ask.account.TESTUSER' }, ...(attr ? { attributes: JSON.parse(attr.slice(7)) } : {}) },
  context: { System: { application: { applicationId: skillId }, user: { userId: 'amzn1.ask.account.TESTUSER' }, device: { deviceId: 'amzn1.ask.device.TEST', supportedInterfaces: { 'Alexa.Presentation.APL': { runtime: { maxVersion: '2024.3' } }, ...(html ? { 'Alexa.Presentation.HTML': { runtime: { maxVersion: '1.1' } } } : {}) } }, apiEndpoint: 'https://api.eu.amazonalexa.com' } },
  request: { requestId: 'amzn1.echo-api.request.test', timestamp: new Date().toISOString(), locale, ...request },
})
const request = soort === 'launch' ? { type: 'LaunchRequest' } : soort === 'request' ? JSON.parse(rest[0]) : { type: 'Alexa.Presentation.APL.UserEvent', token: 'dashboard', arguments: rest }
await page.evaluate((json) => { const el = [...document.querySelectorAll('.ace_editor')].filter((e) => e.getBoundingClientRect().width > 0).sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)[0]; window.ace.edit(el).setValue(json, -1) }, JSON.stringify(basis(request), null, 2))
const leesUit = () => page.evaluate(() => { const eds = [...document.querySelectorAll('.ace_editor')].map((e) => window.ace.edit(e).getValue()).filter((v) => /\"status\"|\"result\"/.test(v)); return eds[eds.length - 1] || '' })
const voor = await leesUit()
await page.getByRole('button', { name: /Submit/i }).first().click({ force: true })
let out = ''
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(2500)
  out = await leesUit()
  if (out && out !== voor) break
}
let samenvatting
try {
  const j = JSON.parse(out)
  const body = j.result?.skillExecutionInfo?.invocationResponse?.body ?? {}
  const r = body.response ?? {}
  const lijst = (d) => d.data?.lijst ?? d.message?.lijst
  samenvatting = { status: j.status, speech: r.outputSpeech?.ssml ?? null, directives: (r.directives ?? []).map((d) => d.type), html: (r.directives ?? []).filter((d) => /HTML/.test(d.type)).map((d) => ({ uri: d.request?.uri, timeout: d.configuration?.timeoutInSeconds, titel: lijst(d)?.titel, items: lijst(d)?.items?.length, eerste: lijst(d)?.items?.[0]?.titel, fout: lijst(d)?.fout })), shouldEndSession: 'shouldEndSession' in r ? r.shouldEndSession : '(niet gezet)', sessie: body.sessionAttributes ?? null, fout: j.result?.error ?? null }
} catch { samenvatting = { ruw: out.slice(0, 400) } }
console.log(JSON.stringify(samenvatting, null, 1))
await browser.close()
