#!/usr/bin/env node
/*
 * Like doe.mjs, but for the Google Cloud tab: picks the open page whose URL contains the first argument.
 *   node tools/console/g.mjs <url-part> "<javascript with page>" <naam>
 */
import { chromium } from 'playwright-core'
import { shot } from './cdp.mjs'
import { PORT } from './browser.mjs'
const [deel, code, naam = 'g'] = process.argv.slice(2)
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
const page = browser.contexts()[0].pages().find((p) => p.url().includes(deel))
if (!page) { console.log('geen tabblad met', deel); process.exit(1) }
try {
  const uit = await new Function('page', `return (async () => { ${code} })()`)(page)
  if (uit !== undefined) console.log('uitkomst:', typeof uit === 'string' ? uit : JSON.stringify(uit).slice(0, 2000))
} catch (e) {
  console.log('FOUT in stap:', e.message.split('\n')[0])
}
console.log(page.url())
console.log('schermafbeelding:', await shot(page, naam))
await browser.close()
