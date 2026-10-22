#!/usr/bin/env node
/*
 * One-time setup for the encrypted route from the Mac to the skill (see lambda/opslag.js):
 *   - makes MAC_SLEUTEL (32 random bytes, base64) when .env has none,
 *   - creates a secret gist with one file, dashboard.json, holding an encrypted empty object,
 *   - writes MAC_GIST_ID and MAC_GIST_URL to .env and gistUrl + macSleutel to lambda/credentials.json.
 * Prints no key and no URL. Afterwards put lambda/credentials.json into the hosted skill (zet-bestand.mjs) and deploy.
 */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { versleutel } = require(join(root, 'lambda', 'opslag.js'))
const gh = existsSync('/opt/homebrew/bin/gh') ? '/opt/homebrew/bin/gh' : 'gh'

const envPad = join(root, '.env')
let env = existsSync(envPad) ? readFileSync(envPad, 'utf8') : ''
const waarde = (naam) => (env.match(new RegExp(`^${naam}=(.*)$`, 'm')) || [])[1]?.trim() || ''
const zet = (naam, w) => {
  env = new RegExp(`^${naam}=`, 'm').test(env) ? env.replace(new RegExp(`^${naam}=.*$`, 'm'), `${naam}=${w}`) : `${env.replace(/\n?$/, '\n')}${naam}=${w}\n`
}

if (waarde('MAC_GIST_ID')) {
  console.log('Er staat al een MAC_GIST_ID in .env; niets gedaan.')
  process.exit(0)
}
const sleutel = waarde('MAC_SLEUTEL') || randomBytes(32).toString('base64')
const inhoud = JSON.stringify(versleutel({ ts: 0 }, sleutel))
const uit = execFileSync(gh, ['gist', 'create', '--filename', 'dashboard.json', '--desc', 'Echo Show-dashboard (versleuteld)', '-'], { input: inhoud }).toString()
const id = (uit.match(/gist\.github\.com\/(?:[^/\s]+\/)?([0-9a-f]{20,})/) || [])[1]
if (!id) throw new Error('Gist-id niet gevonden in de uitvoer van gh')
const eigenaar = execFileSync(gh, ['api', 'user', '-q', '.login']).toString().trim()
const url = `https://gist.githubusercontent.com/${eigenaar}/${id}/raw/dashboard.json`

zet('MAC_SLEUTEL', sleutel)
zet('MAC_GIST_ID', id)
zet('MAC_GIST_URL', url)
writeFileSync(envPad, env)
chmodSync(envPad, 0o600)

const credPad = join(root, 'lambda', 'credentials.json')
const cred = existsSync(credPad) ? JSON.parse(readFileSync(credPad, 'utf8')) : {}
writeFileSync(credPad, JSON.stringify({ ...cred, gistUrl: url, macSleutel: sleutel }, null, 2) + '\n')
chmodSync(credPad, 0o600)
console.log('Geheime gist aangemaakt; sleutel en adres staan in .env en lambda/credentials.json.')
