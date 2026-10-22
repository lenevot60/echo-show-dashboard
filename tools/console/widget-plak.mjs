#!/usr/bin/env node
/*
 * Puts a widget package from skill-package/dataStorePackages/<naam> into the console's widget editor
 * (APL in Code View, DATA, MANIFEST) through the clipboard and saves it under the same name.
 *   node tools/console/widget-plak.mjs youtube-widget
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { connect, shot } from './cdp.mjs'
const naam = process.argv[2]
const map = `skill-package/dataStorePackages/${naam}`
const skillId = readFileSync('tools/console/skill-id.txt', 'utf8').trim()
const { browser, page } = await connect()
await page.goto(`https://developer.amazon.com/alexa/console/ask/displays/widget/${skillId}/dashboard?skillLocale=en_US#/resource/${naam}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(9000)
const titel = await page.evaluate(() => document.body.innerText.includes(location.hash.split('/').pop()))
if (!titel) { console.log('widget niet geopend'); process.exit(1) }

async function plak(knop, bestand) {
  execFileSync('pbcopy', { input: readFileSync(`${map}/${bestand}`) })
  const ed = await page.evaluate(() => {
    const e = [...document.querySelectorAll('.monaco-editor')].find((x) => x.getBoundingClientRect().width > 0)
    const r = e.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + 200 }
  })
  await page.mouse.click(ed.x, ed.y)
  await page.keyboard.press('Meta+A')
  await page.keyboard.press('Meta+V')
  await page.waitForTimeout(1500)
  const tekst = await page.evaluate(() => [...document.querySelectorAll('.monaco-editor')].find((x) => x.getBoundingClientRect().width > 0).innerText.replace(/\s+/g, ' '))
  console.log(knop, '→', tekst.slice(0, 120))
}

// APL: the left rail button, then Code View.
// The rail buttons show a tooltip that covers Code View; move away before clicking it.
await page.mouse.click(38, 112)
await page.mouse.move(700, 600)
await page.waitForTimeout(1500)
await page.getByRole('button', { name: 'Code View', exact: true }).click({ force: true })
await page.waitForTimeout(1500)
await plak('Code View', 'documents/document.json')
await page.mouse.click(38, 170)
await page.waitForTimeout(1500)
await plak('DATA', 'datasources/default.json')
await page.mouse.click(38, 228)
await page.waitForTimeout(1500)
await plak('MANIFEST', 'manifest.json')
await page.mouse.click(1244, 57)
await page.waitForTimeout(4000)
const melding = await page.evaluate(() => (document.body.innerText.match(/[^\n]*(saved successfully|Saved Successfully|error|Error)[^\n]*/g) || []).slice(0, 3).join(' / '))
console.log('opslaan:', melding || '(geen melding)')
console.log('schermafbeelding:', await shot(page, `widget-${naam}`))
await browser.close()
