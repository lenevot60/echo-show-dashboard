#!/usr/bin/env node
/*
 * Adds intents from the local interaction models to the model in the console (JSON Editor), per locale, and saves.
 * Everything else in the console model stays as it is.
 *   node tools/console/model-intents.mjs OpenYouTubeIntent,SearchVideoIntent en-US en-GB nl-NL
 */
import { readFileSync } from 'node:fs'
import { connect, shot } from './cdp.mjs'
const [namen, ...locales] = process.argv.slice(2)
const gezocht = namen.split(',')
const skillId = readFileSync('tools/console/skill-id.txt', 'utf8').trim()
const { browser, page } = await connect()
for (const locale of locales) {
  const lokaal = JSON.parse(readFileSync(`skill-package/interactionModels/custom/${locale}.json`, 'utf8'))
  const nieuw = lokaal.interactionModel.languageModel.intents.filter((i) => gezocht.includes(i.name))
  await page.goto(`https://developer.amazon.com/alexa/console/ask/build/custom/${skillId}/development/${locale.replace('-', '_')}/json-editor`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(8000)
  const tekst = await page.evaluate(() => window.ace.edit(document.querySelector('.ace_editor')).getValue())
  const model = JSON.parse(tekst)
  const lm = model.interactionModel.languageModel
  lm.intents = lm.intents.filter((i) => !gezocht.includes(i.name)).concat(nieuw)
  await page.evaluate((json) => window.ace.edit(document.querySelector('.ace_editor')).setValue(json, -1), JSON.stringify(model, null, 2))
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Save', exact: true }).first().click()
  await page.waitForTimeout(4000)
  const melding = await page.evaluate(() => (document.body.innerText.match(/[^\n]*(Saved|saved|Error|error)[^\n]*/g) || []).slice(0, 2).join(' / '))
  console.log(locale, '| aanroep:', lm.invocationName, '| intents:', lm.intents.map((i) => i.name).join(','), '|', melding)
  await shot(page, `model-${locale}`)
}
await browser.close()
