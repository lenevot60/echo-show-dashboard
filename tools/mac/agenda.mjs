/*
 * Today's and tomorrow's appointments from Google Calendar, through its secret iCal address (GOOGLE_AGENDA_ICS in
 * .env), plus the next waste collection day from the municipality's waste calendar (AFVAL_ICS). A subscribed calendar
 * is not part of Google's secret address, so the waste calendar is read from its own link. Recurring events are
 * expanded by node-ical. Waste days in the personal calendar are recognised by their title.
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
      uit.push({ titel, plek, start, eind, heleDag: Boolean(i.isFullDay || start.dateOnly || ev.datetype === 'date') })
    }
  }
  return uit.sort((a, b) => a.start - b.start)
}

const korteDag = (d) => new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Amsterdam' }).format(d).replace(/\./g, '')

/**
 * Dashboard rows: what is still to come today, then tomorrow; waste days get their own kind. Waste rows may lie
 * further ahead (the next collection day, all bins of that day); appointments stop after tomorrow.
 */
export function vatAgendaSamen(lijst, { nu = new Date(), max = 6 } = {}) {
  const vandaag = dag(nu)
  const morgen = dag(new Date(nu.getTime() + 86_400_000))
  const komend = lijst.filter((a) => (a.heleDag ? dag(a.start) >= vandaag : a.eind > nu))
  const afvalDag = komend.filter((a) => a.afval || AFVAL.test(a.titel)).map((a) => dag(a.start))[0] || null
  const rijen = komend
    .filter((a) => {
      const isAfval = a.afval || AFVAL.test(a.titel)
      return isAfval ? dag(a.start) === afvalDag : dag(a.start) <= morgen
    })
    .map((a) => {
      const afval = Boolean(a.afval || AFVAL.test(a.titel))
      const d = dag(a.start)
      const wanneer = d === vandaag ? 'vandaag' : d === morgen ? 'morgen' : korteDag(a.start)
      return {
        tijd: a.heleDag ? (wanneer === 'vandaag' ? 'hele dag' : wanneer) : `${wanneer === 'vandaag' ? '' : wanneer + ' '}${uurMin(a.start)}`,
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

/**
 * Reads one or more calendars: a URL, or [{ url, afval }]. A waste calendar is read 14 days ahead so the next
 * collection day is always known. One failing calendar does not stop the others; all failing throws the first error.
 */
export async function leesAgenda(bronnen, { nu = new Date(), uren = 40, max = 6 } = {}) {
  const lijst = (Array.isArray(bronnen) ? bronnen : [{ url: bronnen }]).filter((b) => b && b.url)
  const van = new Date(nu.getTime() - 12 * 3_600_000)
  const uitkomst = await Promise.allSettled(
    lijst.map(async (b) => {
      const data = await ical.async.fromURL(b.url, { signal: AbortSignal.timeout(20_000) })
      const tot = new Date(nu.getTime() + (b.afval ? 14 * 24 : uren) * 3_600_000)
      return instanties(data, { van, tot }).map((a) => ({ ...a, afval: Boolean(b.afval) }))
    }),
  )
  const gelukt = uitkomst.filter((u) => u.status === 'fulfilled')
  if (!gelukt.length && uitkomst.length) throw uitkomst[0].reason
  const alle = gelukt.flatMap((u) => u.value).sort((a, b) => a.start - b.start)
  return vatAgendaSamen(alle, { nu, max })
}

export { ical }
