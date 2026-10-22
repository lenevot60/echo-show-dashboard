#!/usr/bin/env node
/*
 * Puts local files into the hosted skill's code editor (Code tab) and saves them; with --deploy it deploys afterwards.
 *   node tools/console/zet-bestand.mjs lambda/index.js lambda/apl/dashboard.json [--deploy]
 * Paths are relative to this repository; the console tree starts at "lambda". A file is only written after its own
 * tab is the active one (a single click on a tree node selects, it does not open; 21-10 that put config.json into
 * index.js).
 */
import { readFileSync } from 'node:fs'
import { connect } from './cdp.mjs'

const args = process.argv.slice(2)
const deploy = args.includes('--deploy')
const bestanden = args.filter((a) => !a.startsWith('--'))
const skillId = readFileSync('tools/console/skill-id.txt', 'utf8').trim()
const { browser, page } = await connect()
if (!page.url().includes('/ask/editor/')) {
  await page.goto(`https://developer.amazon.com/alexa/console/ask/editor/${skillId}/development/en_US`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(8000)
}

const zichtbaar = (tekst) => page.evaluate((tekst) => [...document.querySelectorAll('.tree-node-title')].some((e) => e.innerText.trim() === tekst && e.getBoundingClientRect().width > 0), tekst)
const plek = (tekst) => page.evaluate((tekst) => {
  const el = [...document.querySelectorAll('.tree-node-title')].find((e) => e.innerText.trim() === tekst && e.getBoundingClientRect().width > 0)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x + 20, y: r.y + r.height / 2 }
}, tekst)
const actieveTab = () => page.evaluate(() => {
  const tabs = [...document.querySelectorAll('.tabs__header-tab')].map((e) => ({ naam: e.innerText.split('\n')[0].trim(), actief: e.className.includes('active') }))
  const a = tabs.find((x) => x.actief)
  return { alle: tabs.map((x) => x.naam), actief: a ? a.naam : null }
})
const openTab = (naam) => page.evaluate((naam) => {
  const tab = [...document.querySelectorAll('.tabs__header-tab')].find((e) => e.innerText.split('\n')[0].trim() === naam)
  if (!tab) return false
  ;(tab.firstElementChild || tab).click()
  return true
}, naam)

const uitkomst = []
for (const pad of bestanden) {
  const delen = pad.split('/')
  const naam = delen[delen.length - 1]
  const inhoud = readFileSync(pad, 'utf8')
  for (const map of delen.slice(1, -1)) {
    if (!(await zichtbaar(naam))) {
      const p = await plek(map)
      if (p) { await page.mouse.dblclick(p.x, p.y); await page.waitForTimeout(1200) }
    }
  }
  if (!(await openTab(naam))) {
    const p = await plek(naam)
    if (!p) { uitkomst.push({ pad, fout: 'niet in de boom' }); continue }
    await page.mouse.dblclick(p.x, p.y)
  }
  await page.waitForTimeout(1500)
  const tab = await actieveTab()
  if (tab.actief !== naam) { uitkomst.push({ pad, fout: 'bestand niet geopend, niets geschreven', tab }); continue }
  const gezet = await page.evaluate((inhoud) => {
    const el = [...document.querySelectorAll('.ace_editor')].find((e) => e.getBoundingClientRect().width > 0)
    if (!el || !window.ace) return { fout: 'geen editor' }
    const ed = window.ace.edit(el)
    const oud = ed.getValue()
    ed.setValue(inhoud, -1)
    return { oudBegin: oud.slice(0, 30), gelijk: ed.getValue() === inhoud }
  }, inhoud)
  await page.getByRole('button', { name: 'Save', exact: true }).first().click({ force: true })
  await page.waitForTimeout(2500)
  uitkomst.push({ pad, actief: tab.actief, ...gezet })
}
let deployLog = null
if (deploy && uitkomst.every((u) => u.gelijk)) {
  await page.getByRole('button', { name: 'Deploy', exact: true }).first().click({ force: true })
  const t0 = Date.now()
  let laatste = ''
  deployLog = []
  while (Date.now() - t0 < 180000) {
    await page.waitForTimeout(4000)
    const nu = (await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); const t = ((e.innerText || '') + '').trim(); return r.width && r.height && e.children.length === 0 && /Deploying|Last Deployed|fail|error/i.test(t) && t.length < 120 }).map((e) => e.innerText.trim()))).join(' | ')
    if (nu !== laatste) { deployLog.push(`${Math.round((Date.now() - t0) / 1000)}s: ${nu}`); laatste = nu }
    if (!/Deploying/i.test(nu) && Date.now() - t0 > 12000) break
  }
} else if (deploy) deployLog = ['niet uitgerold: niet elk bestand is goed gezet']
console.log(JSON.stringify({ uitkomst, deployLog }, null, 1))
await browser.close()
