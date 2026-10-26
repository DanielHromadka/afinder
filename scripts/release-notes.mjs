// Writes the release notes for a new version (run by the release workflow, Node 24: it imports the shared .ts
// directly). The notes are the commits since the commit the latest published release was built from, read
// from the marker in that release's body; app-irrelevant paths (phone app, website, docs) are left out.
//
//   npm run release-notes -- --version 1.1.57 [--repo owner/name] [--md release-notes.md] [--json build/release-notes.json]
//
// --md is the GitHub release body, --json the last releases bundled into the app for its "What's new" dialog.
// GH_TOKEN (optional) raises the GitHub API rate limit.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { bodyLines, MAX_NOTES, noteLines, releaseBody, releaseCommit } from '../src/shared/releaseNotes.ts'

const { values: args } = parseArgs({
  options: {
    version: { type: 'string' },
    repo: { type: 'string', default: 'DanielHromadka/afinder-downloads' },
    md: { type: 'string', default: 'release-notes.md' },
    json: { type: 'string', default: 'build/release-notes.json' }
  }
})
if (!args.version) throw new Error('--version is required')

const EXCLUDE = [':(exclude)mobile', ':(exclude)website', ':(exclude)docs', ':(exclude)feedback']
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

async function releases() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'afinder-release-notes' }
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`
  try {
    const res = await fetch(`https://api.github.com/repos/${args.repo}/releases?per_page=${MAX_NOTES}`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()).filter((r) => !r.draft)
  } catch (err) {
    console.warn(`::warning::Previous releases not read (${err.message}); notes cover the last commit only`)
    return []
  }
}

const exists = (sha) => {
  try {
    git('cat-file', '-e', `${sha}^{commit}`)
    return true
  } catch {
    return false
  }
}

const previous = await releases()
// The newest release that has the marker (the first ones after this script was added have none).
const since = previous.map((r) => releaseCommit(r.body)).find(Boolean) ?? null
const range = since && exists(since) ? [`${since}..HEAD`] : ['-1', 'HEAD']
const log = git('log', '--no-merges', '--reverse', '--format=%s%x1f%b%x1e', ...range, '--', '.', ...EXCLUDE)
const commits = log
  .split('\x1e')
  .map((c) => c.trim())
  .filter(Boolean)
  .map((c) => {
    const [subject, body = ''] = c.split('\x1f')
    return { subject, body }
  })
const lines = noteLines(commits)
const head = git('rev-parse', 'HEAD').trim()

writeFileSync(args.md, releaseBody(args.version, lines, head))
const notes = [
  { version: args.version, date: new Date().toISOString(), notes: lines.length ? lines : [`aFinder ${args.version}`] },
  ...previous
    .map((r) => ({ version: r.tag_name.replace(/^v/, ''), date: r.published_at ?? r.created_at, notes: bodyLines(r.body).filter((l) => !/^aFinder [\d.]+$/.test(l)) }))
    // Releases whose only note was "aFinder 0.9.8" say nothing.
    .filter((r) => r.notes.length)
    .sort((a, b) => b.date.localeCompare(a.date))
].slice(0, MAX_NOTES)
mkdirSync(dirname(args.json), { recursive: true })
writeFileSync(args.json, `${JSON.stringify(notes, null, 2)}\n`)
console.log(`${args.version}: ${lines.length} notes since ${since ?? 'the last commit'}\n${lines.map((l) => `  - ${l}`).join('\n')}`)
