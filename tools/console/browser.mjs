#!/usr/bin/env node
/*
 * A separate Chrome profile for the Alexa Developer Console, as a real window (Amazon blocks headless logins),
 * with remote debugging so the scripts in this folder can drive it.
 *   node tools/console/browser.mjs start     opens the window on the console sign-in page
 *   node tools/console/browser.mjs status    tells whether Chrome answers on the debugging port
 * The profile lives outside the repository; nothing from it is ever committed.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PORT = 9447
export const PROFILE = join(homedir(), 'Library', 'Application Support', 'EchoShow-Amazon-Chrome')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const START_URL = 'https://developer.amazon.com/alexa/console/ask'

export async function status() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

async function start() {
  if (await status()) {
    console.log(`Chrome luistert al op poort ${PORT}`)
    return
  }
  mkdirSync(PROFILE, { recursive: true })
  const child = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1400,980',
      START_URL,
    ],
    { detached: true, stdio: 'ignore' },
  )
  child.unref()
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (await status()) {
      console.log(`Chrome gestart (poort ${PORT}, profiel ${PROFILE}); log in op ${START_URL}`)
      return
    }
  }
  console.error('Chrome antwoordt niet op de debugpoort')
  process.exit(1)
}

const [cmd = 'status'] = process.argv.slice(2)
if (cmd === 'start') await start()
else console.log((await status()) ? `Chrome luistert op poort ${PORT}` : 'Chrome draait niet')
