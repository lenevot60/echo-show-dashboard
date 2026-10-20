#!/usr/bin/env node
/*
 * Runs one Playwright step against the console tab, then prints the page and saves a screenshot.
 *   node tools/console/doe.mjs "<javascript with page>" <naam>
 * The snippet runs inside an async function with `page` in scope.
 */
import { connect, overzicht, shot } from './cdp.mjs'
const [code, naam = 'doe', wacht = '3000'] = process.argv.slice(2)
const { browser, page } = await connect()
try {
  const fn = new Function('page', `return (async () => { ${code} })()`)
  const uit = await fn(page)
  if (uit !== undefined) console.log('uitkomst:', typeof uit === 'string' ? uit : JSON.stringify(uit).slice(0, 2000))
} catch (e) {
  console.log('FOUT in stap:', e.message.split('\n')[0])
}
await page.waitForTimeout(Number(wacht))
const o = await overzicht(page, 160)
console.log(o.url, '|', o.titel)
for (const [i, r] of o.items.entries()) console.log(String(i).padStart(3), r)
console.log('schermafbeelding:', await shot(page, naam))
await browser.close()
