/*
 * Open tasks from Apple Reminders (synced with the iPhone), read with JavaScript for Automation. The first run asks
 * macOS for permission for the process that runs this script.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = `
const app = Application('Reminders');
const uit = [];
app.lists().forEach((l) => {
  const open = l.reminders.whose({ completed: false });
  const namen = open.name();
  if (!namen.length) return;
  let due = [], vlag = [], prio = [];
  try { due = open.dueDate(); } catch (e) {}
  try { vlag = open.flagged(); } catch (e) {}
  try { prio = open.priority(); } catch (e) {}
  const lijst = l.name();
  namen.forEach((n, i) => uit.push({ titel: n, lijst, due: due[i] ? due[i].toISOString() : null, vlag: !!vlag[i], prio: prio[i] || 0 }));
});
JSON.stringify(uit);
`

const BIN = join(dirname(fileURLToPath(import.meta.url)), 'bin', 'herinneringen')

/** EventKit helper (tools/mac/bin/herinneringen, half a second) when built; AppleScript (up to a minute) otherwise. */
export function leesHerinneringen() {
  if (existsSync(BIN)) {
    const out = execFileSync(BIN, [], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 })
    return JSON.parse(out.toString('utf8') || '[]')
  }
  const out = execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SCRIPT], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
  return JSON.parse(out.toString('utf8') || '[]')
}

const dag = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(d)
const uurMin = (d) => new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }).format(d)

/** Overdue and due-today first, then flagged and high priority; at most `max`. Lists can be limited. */
export function kiesTaken(alle, { nu = new Date(), max = 4, lijsten = [] } = {}) {
  const vandaag = dag(nu)
  const morgen = dag(new Date(nu.getTime() + 86_400_000))
  const gekozen = alle
    .filter((t) => !lijsten.length || lijsten.includes(t.lijst))
    .map((t) => {
      const d = t.due ? new Date(t.due) : null
      const dd = d ? dag(d) : null
      let wanneer = ''
      let gewicht = 9
      if (d && dd < vandaag) { wanneer = 'te laat'; gewicht = 0 }
      else if (dd === vandaag) { wanneer = t.heeftTijd ? `vandaag ${uurMin(d)}` : 'vandaag'; gewicht = 1 }
      else if (dd === morgen) { wanneer = 'morgen'; gewicht = 3 }
      else if (t.vlag) gewicht = 2
      else if (t.prio && t.prio > 0 && t.prio <= 4) gewicht = 4
      return { titel: String(t.titel).slice(0, 60), lijst: t.lijst, wanneer, gewicht, d: d ? d.getTime() : Infinity }
    })
    .filter((t) => t.gewicht < 9)
    .sort((a, b) => a.gewicht - b.gewicht || a.d - b.d)
  return { open: gekozen.length, lijst: gekozen.slice(0, max).map(({ gewicht, d, ...rest }) => rest) }
}
