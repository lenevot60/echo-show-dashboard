#!/usr/bin/env node
/* Opens the Alexa web app in a second tab of the signed-in profile and prints what it shows (device language check). */
import { chromium } from 'playwright-core'
import { PORT } from './browser.mjs'
const [url = 'https://alexa.amazon.nl/'] = process.argv.slice(2)
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
const ctx = browser.contexts()[0]
let page = ctx.pages().find((p) => /alexa\.amazon\./.test(p.url()))
if (!page) page = await ctx.newPage()
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(6000)
const t = await page.evaluate(() => document.body.innerText)
console.log(JSON.stringify({ url: page.url().slice(0, 140), titel: await page.title(), tekst: t.replace(/\s+/g, ' ').slice(0, 900) }, null, 1))
await page.screenshot({ path: 'tools/console/shots/82-alexa-web.png' })
await browser.close()
