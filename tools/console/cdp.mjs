/*
 * Helpers to drive the signed-in Chrome profile (tools/console/browser.mjs) with Playwright over CDP.
 * Only the console tab is used; nothing is typed into password fields and nothing from the profile is read.
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PORT } from './browser.mjs'

export const SHOTS = join(process.cwd(), 'tools', 'console', 'shots')

export async function connect() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
  const context = browser.contexts()[0]
  const pages = context.pages()
  const page = pages.find((p) => /developer\.amazon\.com/.test(p.url())) ?? pages[0] ?? (await context.newPage())
  return { browser, context, page }
}

export async function shot(page, naam) {
  mkdirSync(SHOTS, { recursive: true })
  const pad = join(SHOTS, `${naam}.png`)
  await page.screenshot({ path: pad, fullPage: false })
  return pad
}

/** Visible text of buttons, links, inputs and headings, numbered, to find the next click without guessing. */
export async function overzicht(page, max = 120) {
  return page.evaluate((max) => {
    const zichtbaar = (el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    }
    const sel = 'a,button,input,select,textarea,h1,h2,h3,[role=button],[role=tab],[role=menuitem],[role=link]'
    const out = []
    for (const el of document.querySelectorAll(sel)) {
      if (!zichtbaar(el)) continue
      const tekst = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ')
      if (!tekst && el.tagName !== 'INPUT') continue
      out.push(`${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ''} ${tekst.slice(0, 80)}`)
      if (out.length >= max) break
    }
    return { url: location.href, titel: document.title, items: out }
  }, max)
}

export async function klik(page, tekst, { exact = false, nth = 0 } = {}) {
  const loc = page.getByText(tekst, { exact }).nth(nth)
  await loc.waitFor({ state: 'visible', timeout: 15000 })
  await loc.click()
}
