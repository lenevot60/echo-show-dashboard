#!/usr/bin/env node
/*
 * Reads the skill's CloudWatch log events (all streams, last N minutes) in the signed-in AWS console tab and prints
 * them. Needs the AWS console open once via Code > CloudWatch Logs.
 *   node tools/console/logs.mjs [minuten=90] [filter]
 */
import { chromium } from 'playwright-core'
import { PORT } from './browser.mjs'
const [minuten = '90', filter = ''] = process.argv.slice(2)
const groep = '/aws/lambda/10add32d-5879-4cf9-b6eb-ddc50eb1e369'
const enc = (s) => encodeURIComponent(encodeURIComponent(s)).replace(/%/g, '$')
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
const page = browser.contexts()[0].pages().find((p) => p.url().includes('console.aws.amazon.com/cloudwatch'))
if (!page) { console.log('geen CloudWatch-tabblad open'); process.exit(1) }
const start = -Number(minuten) * 60000
await page.goto(`https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups/log-group/${enc(groep)}/log-events$3Fstart$3D${start}${filter ? `$26filterPattern$3D${enc(filter)}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(12000)
// The list starts at the oldest event; keep loading newer ones.
for (let i = 0; i < 15; i++) {
  let geklikt = false
  for (const f of page.frames()) {
    const knop = f.getByText(/Mehr laden|Load more/).first()
    if (await knop.count().catch(() => 0)) { await knop.click().catch(() => {}); geklikt = true }
  }
  if (!geklikt) break
  await page.waitForTimeout(2500)
}
const teksten = []
for (const f of page.frames()) {
  const t = await f.evaluate(() => document.body ? document.body.innerText : '').catch(() => '')
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t)) teksten.push(t)
}
console.log(teksten.join('\n----\n').split('\n').filter((r) => r.trim()).slice(0, 400).join('\n'))
await browser.close()
