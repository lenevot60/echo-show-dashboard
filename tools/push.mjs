#!/usr/bin/env node
/*
 * Collects everything for the dashboard on this Mac and sends it to the Echo Show: encrypted through a secret gist to
 * the skill (full screen), and to the device data store (widget, once the device has the package). Sources:
 * weather and rain (Buienradar), travel time and map (Google), appointments and waste days (Google Calendar iCal),
 * tasks (Apple Reminders) and the Claude Code sessions on this Mac. Each source is optional; a failing source adds a
 * short line to `meldingen` instead of stopping the rest.
 *   node tools/push.mjs --proef    prints what would be sent (Google is not called without a key)
 *   node tools/push.mjs            sends it
 * Runs every 10 minutes through launchd (tools/nl.dashboard.push.plist). Secrets live in .env, never in git.
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { claudeChats } from './mac/claude-chats.mjs'
import { kiesTaken, leesHerinneringen } from './mac/herinneringen.mjs'
import { leesAgenda } from './mac/agenda.mjs'
import { routeNaarWerk, vertrekAdvies } from './mac/route.mjs'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bronnen = require(join(root, 'lambda', 'bronnen.js'))
const { versleutel } = require(join(root, 'lambda', 'opslag.js'))
const gh = existsSync('/opt/homebrew/bin/gh') ? '/opt/homebrew/bin/gh' : 'gh'

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
const cfg = bronnen.config()
const meldingen = []
const poging = async (naam, fn) => {
  try {
    return await fn()
  } catch (e) {
    meldingen.push(`${naam}: ${String(e && e.message ? e.message : e).slice(0, 120)}`)
    return null
  }
}

const basis = await bronnen.verzamel()
if (basis.fout) meldingen.push(basis.fout)
const nu = new Date()
const key = process.env.GOOGLE_MAPS_KEY || ''
const agendaBronnen = [
  ...String(process.env.GOOGLE_AGENDA_ICS || '').split(/[\s,]+/).filter(Boolean).map((url) => ({ url })),
  ...String(process.env.AFVAL_ICS || '').split(/[\s,]+/).filter(Boolean).map((url) => ({ url, afval: true })),
]
const agenda = agendaBronnen.length ? await poging('Agenda', () => leesAgenda(agendaBronnen, { nu })) : null
const route = await poging('Route', () => routeNaarWerk({ key, van: cfg.thuis, naar: cfg.werk, uren: cfg.routeUren || [6, 21], nu }))
const vertrek = agenda ? await poging('Vertrekadvies', () => vertrekAdvies({ agenda, werkRoute: route, key, van: cfg.thuis, werkPatroon: cfg.werkPatroon, nu })) : null
const taken = await poging('Herinneringen', () => kiesTaken(leesHerinneringen(), { nu, lijsten: cfg.takenLijsten || [], bereik: cfg.takenBereik || 'alles' }))
const claude = await poging('Claude-chats', () => claudeChats())

const content = {
  ...basis,
  fout: null,
  route: route ? { minuten: route.minuten, normaal: route.normaal, vertraging: route.vertraging, km: route.km, via: route.via, kaartUrl: route.kaartUrl, van: 'Nieuw-Vossemeer', naar: 'Sliedrecht' } : null,
  vertrek,
  agenda: agenda || [],
  aantalAgenda: (agenda || []).length,
  afval: (agenda || []).filter((a) => a.soort === 'afval').slice(0, 2),
  taken: taken ? taken.lijst : [],
  aantalTaken: taken ? taken.open : 0,
  claude: claude || { bezig: 0, wacht: 0, vragen: 0, lijst: [] },
  meldingen: meldingen.slice(0, 4),
}
const tekst = JSON.stringify(content)
const grootte = Buffer.byteLength(tekst, 'utf8')
if (grootte > 15 * 1024) {
  console.error(`Inhoud is ${grootte} bytes; de Data Store accepteert hooguit 16 KB per verzoek.`)
  process.exit(1)
}
const kaal = (o) => JSON.stringify(o, (k, v) => (k === 'kaartUrl' && v ? v.replace(/key=[^&]+/, 'key=…') : v), 2)
if (proef) {
  console.log(kaal(content))
  console.log(`\nproefdraai: ${grootte} bytes, niets verstuurd`)
  process.exit(0)
}

const userId = process.env.ALEXA_USER_ID
const creds = bronnen.credentials()
if (!userId || !creds.clientId || !creds.clientSecret) {
  console.error('Vul ALEXA_USER_ID, ALEXA_CLIENT_ID en ALEXA_CLIENT_SECRET in .env (zie .env.example).')
  process.exit(1)
}

// 1. To the skill, encrypted through a secret gist (lambda/opslag.js, set up once with tools/gist-maken.mjs): the full
//    screen shows it, also without the widget package on the device. Only what the skill cannot collect itself.
const macDeel = (c) => ({ ts: c.ts, bijgewerktTekst: c.bijgewerktTekst, route: c.route, vertrek: c.vertrek, agenda: c.agenda, aantalAgenda: c.aantalAgenda, afval: c.afval, taken: c.taken, aantalTaken: c.aantalTaken, claude: c.claude })
if (process.env.MAC_SLEUTEL && process.env.MAC_GIST_ID) {
  try {
    const pakket = JSON.stringify(versleutel(macDeel(content), process.env.MAC_SLEUTEL))
    execFileSync(gh, ['api', '--method', 'PATCH', `/gists/${process.env.MAC_GIST_ID}`, '--input', '-'], {
      input: JSON.stringify({ files: { 'dashboard.json': { content: pakket } } }),
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    console.log(`${new Date().toISOString()} versleuteld naar de gist (${Buffer.byteLength(pakket, 'utf8')} bytes)`)
  } catch (e) {
    console.error('Gist niet bijgewerkt:', String(e.stderr || e.message || e).slice(0, 200))
  }
} else {
  console.error('MAC_SLEUTEL of MAC_GIST_ID ontbreekt; draai eenmalig node tools/gist-maken.mjs')
}

// 2. To the device data store (widget). Fails with INVALID_DEVICE as long as the device has no package of this skill.
try {
  const result = await bronnen.pushNaarDataStore({
    content,
    target: { type: 'USER', id: userId },
    endpoint: process.env.DATASTORE_ENDPOINT || cfg.datastoreEndpoint,
    creds,
  })
  const per = (result.results ?? []).filter((r) => !/does not support/.test(r.message || '')).map((r) => `${String(r.deviceId).slice(0, 22)}…: ${r.type}${r.message ? ` (${r.message})` : ''}`)
  console.log(`${new Date().toISOString()} verstuurd (${grootte} bytes)${meldingen.length ? ` · ${meldingen.length} melding(en)` : ''}`)
  for (const r of per) console.log('  ' + r)
  if (result.queuedResultId) console.log('  in wachtrij voor een offline toestel')
} catch (e) {
  console.error('Push mislukt:', e.message || e)
  process.exit(1)
}
