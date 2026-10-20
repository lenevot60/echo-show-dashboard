#!/usr/bin/env node
/* Navigates the console tab to a URL, waits, prints what is there and saves a screenshot. */
import { connect, overzicht, shot } from './cdp.mjs'
const [url, naam = 'ga'] = process.argv.slice(2)
const { browser, page } = await connect()
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(4000)
const o = await overzicht(page, 160)
console.log(o.url, '|', o.titel)
for (const [i, r] of o.items.entries()) console.log(String(i).padStart(3), r)
console.log('schermafbeelding:', await shot(page, naam))
await browser.close()
