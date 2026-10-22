/*
 * Today's and tomorrow's appointments from one Google Calendar, through its secret iCal address (GOOGLE_AGENDA_ICS in
 * .env). Recurring events are expanded by node-ical. Waste collection days (when the waste calendar is subscribed in
 * the same Google account) are recognised by their title.
 */
import ical from 'node-ical'

const AFVAL = /\b(gft|pmd|plastic|rest ?afval|restafval|papier|karton|glas|textiel|kerstbo(om|men)|grof ?vuil|groente|containers?)\b/i

const dag = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(d)
const uurMin = (d) => new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }).format(d)

/** All instances between van and tot from parsed node-ical data. */
export function instanties(data, { van, tot }) {
  const uit = []
  for (const ev of Object.values(data)) {
    if (!ev || ev.type !== 'VEVENT') continue
    if (ev.status === 'CANCELLED') continue
    const lijst = ical.expandRecurringEvent(ev, { from: van, to: tot, expandOngoing: true })
    for (const i of lijst) {
      const start = i.start instanceof Date ? i.start : new Date(i.start)
      const eind = i.end instanceof Date ? i.end : new Date(i.end || start)
      if (eind < van || start > tot) continue
      const titel = String((i.summary && i.summary.val) || i.summary || ev.summary || '').trim()
      const plek = String(ev.location || '').trim()
      uit.push({ titel, plek, start, eind, heleDag: Boolean(i.isFullDay || start.dateOnly) })
    }
  }
  return uit.sort((a, b) => a.start - b.start)
}

/** Dashboard rows: what is still to come today, then tomorrow; waste days get their own kind. */
export function vatAgendaSamen(lijst, { nu = new Date(), max = 6 } = {}) {
  const vandaag = dag(nu)
  const rijen = lijst
    .filter((a) => a.heleDag ? dag(a.start) >= vandaag : a.eind > nu)
    .map((a) => {
      const afval = AFVAL.test(a.titel)
      const wanneer = dag(a.start) === vandaag ? 'vandaag' : 'morgen'
      return {
        tijd: a.heleDag ? (wanneer === 'vandaag' ? 'hele dag' : 'morgen') : `${wanneer === 'morgen' ? 'morgen ' : ''}${uurMin(a.start)}`,
        titel: a.titel.slice(0, 60),
        plek: a.plek.split('\n')[0].slice(0, 60),
        soort: afval ? 'afval' : 'afspraak',
        dag: wanneer,
        startIso: a.start.toISOString(),
        heleDag: a.heleDag,
      }
    })
  return rijen.slice(0, max)
}

export async function leesAgenda(url, { nu = new Date(), uren = 40, max = 6 } = {}) {
  const data = await ical.async.fromURL(url, { signal: AbortSignal.timeout(20_000) })
  const van = new Date(nu.getTime() - 12 * 3_600_000)
  const tot = new Date(nu.getTime() + uren * 3_600_000)
  return vatAgendaSamen(instanties(data, { van, tot }), { nu, max })
}

export { ical }
