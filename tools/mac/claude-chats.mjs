/*
 * Claude Code sessions on this Mac, for the dashboard: which ones are working, which are waiting for you.
 * Source: ~/.claude/sessions/<pid>.json (one per running session: name, cwd, status busy/idle) and the session's
 * transcript (~/.claude/projects/<project>/<sessionId>.jsonl) for its title and an open question (AskUserQuestion
 * without an answer). Only reads; never touches the sessions. claude.ai chats and cloud sessions are not on disk.
 */
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

const BASIS = join(homedir(), '.claude')

function leeft(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

/** The last part of a transcript (they grow to many MB); starts at a full line. */
function staart(pad, bytes = 600_000) {
  const grootte = statSync(pad).size
  const start = Math.max(0, grootte - bytes)
  const fd = openSync(pad, 'r')
  const buf = Buffer.alloc(grootte - start)
  readSync(fd, buf, 0, buf.length, start)
  closeSync(fd)
  const tekst = buf.toString('utf8')
  return start > 0 ? tekst.slice(tekst.indexOf('\n') + 1) : tekst
}

/** Title and whether a question to the user is still open, from transcript lines. */
export function leesTranscript(tekst) {
  let titel = null
  const open = new Set()
  for (const regel of tekst.split('\n')) {
    if (!regel) continue
    let d
    try {
      d = JSON.parse(regel)
    } catch {
      continue
    }
    if (d.type === 'ai-title' && d.aiTitle) titel = d.aiTitle
    if (d.type === 'custom-title' && d.customTitle) titel = d.customTitle
    const inhoud = d.message?.content
    if (!Array.isArray(inhoud)) continue
    if (d.type === 'assistant') for (const c of inhoud) if (c.type === 'tool_use' && c.name === 'AskUserQuestion') open.add(c.id)
    if (d.type === 'user') for (const c of inhoud) if (c.type === 'tool_result') open.delete(c.tool_use_id)
  }
  return { titel, vraagOpen: open.size > 0 }
}

function vindTranscript(sessionId) {
  const projecten = join(BASIS, 'projects')
  for (const map of readdirSync(projecten)) {
    const pad = join(projecten, map, `${sessionId}.jsonl`)
    if (existsSync(pad)) return pad
  }
  return null
}

function tijd(ms) {
  return new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }).format(new Date(ms))
}

/** Pure part: sessions plus transcript facts to the dashboard object. */
export function vatSamen(sessies, { max = 5 } = {}) {
  const rang = { vraag: 0, bezig: 1, klaar: 2 }
  const lijst = sessies
    .map((s) => {
      const soort = s.vraagOpen ? 'vraag' : s.status === 'busy' ? 'bezig' : 'klaar'
      const label = soort === 'vraag' ? 'wacht op antwoord' : soort === 'bezig' ? 'bezig' : 'wacht op jou'
      const titel = (s.titel || `${basename(String(s.cwd || '').trim())} · ${s.name || ''}`).slice(0, 60)
      return { titel, soort, label, sinds: tijd(s.statusUpdatedAt || s.updatedAt || Date.now()), t: s.statusUpdatedAt || 0 }
    })
    .sort((a, b) => rang[a.soort] - rang[b.soort] || b.t - a.t)
  return {
    bezig: lijst.filter((x) => x.soort === 'bezig').length,
    wacht: lijst.filter((x) => x.soort !== 'bezig').length,
    vragen: lijst.filter((x) => x.soort === 'vraag').length,
    lijst: lijst.slice(0, max).map(({ t, ...rest }) => rest),
  }
}

export function claudeChats({ max = 5 } = {}) {
  const map = join(BASIS, 'sessions')
  if (!existsSync(map)) return vatSamen([], { max })
  const sessies = []
  for (const f of readdirSync(map)) {
    if (!f.endsWith('.json')) continue
    let s
    try {
      s = JSON.parse(readFileSync(join(map, f), 'utf8'))
    } catch {
      continue
    }
    if (s.kind && s.kind !== 'interactive') continue
    if (!s.pid || !leeft(s.pid)) continue
    let feiten = { titel: null, vraagOpen: false }
    const pad = s.sessionId ? vindTranscript(s.sessionId) : null
    if (pad) {
      try {
        feiten = leesTranscript(staart(pad))
      } catch {}
    }
    sessies.push({ ...s, ...feiten })
  }
  return vatSamen(sessies, { max })
}
