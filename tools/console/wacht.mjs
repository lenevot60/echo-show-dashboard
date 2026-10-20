#!/usr/bin/env node
/* Waits until the console tab leaves the create flow (skill created) or shows an error; prints the outcome. */
import { connect, overzicht, shot } from './cdp.mjs'
const [maxSec = '600'] = process.argv.slice(2)
const { browser, page } = await connect()
const t0 = Date.now()
let laatste = ''
while (Date.now() - t0 < Number(maxSec) * 1000) {
  const url = page.url()
  const teksten = await page.evaluate(() => { const out = []; const pak = (root) => { for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) pak(el.shadowRoot); const r = el.getBoundingClientRect(); const t = (el.innerText || '').trim(); if (r.width && r.height && el.children.length === 0 && t && t.length < 200) out.push(t) } }; pak(document); return out }).catch(() => [])
  const fout = teksten.find((t) => /fail|error|unable|could not|invalid/i.test(t) && !/common issues/i.test(t))
  const status = teksten.filter((t) => /Validating|Creating|Importing|Provisioning|Deploying|minute|Please wait/i.test(t)).join(' | ')
  if (status !== laatste) { console.log(`${Math.round((Date.now() - t0) / 1000)}s: ${status || '(geen voortgangstekst)'}`); laatste = status }
  if (/\/ask\/build\//.test(url) || /\/ask\/amzn1\./.test(url)) { console.log('KLAAR:', url); console.log('schermafbeelding:', await shot(page, 'wacht-klaar')); await browser.close(); process.exit(0) }
  if (fout) { console.log('FOUT:', fout); console.log('schermafbeelding:', await shot(page, 'wacht-fout')); await browser.close(); process.exit(1) }
  await new Promise((r) => setTimeout(r, 5000))
}
console.log('TIMEOUT na', maxSec, 's op', page.url())
await browser.close()
process.exit(2)
