#!/usr/bin/env node
/*
 * Pushes fresh content to the widget on the Echo Show, from this Mac, without a voice command.
 *   node tools/push.mjs --proef    prints what would be sent (no network to Amazon)
 *   node tools/push.mjs            gets a token and sends the content to the user's devices
 * Reads .env in the project root (client id and secret of the skill, the user id). Run it every few minutes with
 * launchd (tools/nl.dashboard.push.plist) for a widget that stays current.
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bronnen = require(join(root, 'lambda', 'bronnen.js'))

const envPad = join(root, '.env')
if (existsSync(envPad)) {
  for (const regel of readFileSync(envPad, 'utf8').split('\n')) {
    const m = regel.match(/^([A-Z_]+)=(.*)$/)
    if (!m) continue
    const waarde = m[2].replace(/\s+#.*$/, '').trim()
    if (waarde && !process.env[m[1]]) process.env[m[1]] = waarde
  }
}

const proef = process.argv.includes('--proef')
const content = await bronnen.verzamel()
const grootte = Buffer.byteLength(JSON.stringify(content), 'utf8')
if (grootte > 15 * 1024) {
  console.error(`Inhoud is ${grootte} bytes; de Data Store accepteert hooguit 16 KB per verzoek. Kort notities.json in.`)
  process.exit(1)
}
if (proef) {
  console.log(JSON.stringify(content, null, 2))
  console.log(`\nproefdraai: ${grootte} bytes, niets verstuurd`)
  process.exit(0)
}

const userId = process.env.ALEXA_USER_ID
const creds = bronnen.credentials()
if (!userId || !creds.clientId || !creds.clientSecret) {
  console.error('Vul ALEXA_USER_ID, ALEXA_CLIENT_ID en ALEXA_CLIENT_SECRET in .env (zie .env.example).')
  process.exit(1)
}
try {
  const result = await bronnen.pushNaarDataStore({
    content,
    target: { type: 'USER', id: userId },
    endpoint: process.env.DATASTORE_ENDPOINT || bronnen.config().datastoreEndpoint,
    creds,
  })
  const per = (result.results ?? []).map((r) => `${r.deviceId}: ${r.type}${r.message ? ` (${r.message})` : ''}`)
  console.log(`${new Date().toISOString()} verstuurd (${grootte} bytes)`)
  for (const r of per) console.log('  ' + r)
  if (result.queuedResultId) console.log('  in wachtrij voor een offline toestel: ' + result.queuedResultId)
} catch (e) {
  console.error('Push mislukt:', e.message || e)
  process.exit(1)
}
