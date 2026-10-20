#!/usr/bin/env node
/* Prints what the console tab shows now (url, title, clickable texts) and saves a screenshot. */
import { connect, overzicht, shot } from './cdp.mjs'
const { browser, page } = await connect()
const o = await overzicht(page)
console.log(o.url, '|', o.titel)
for (const [i, r] of o.items.entries()) console.log(String(i).padStart(3), r)
console.log('schermafbeelding:', await shot(page, process.argv[2] || 'kijk'))
await browser.close()
