// Git status for the file list: parsing `git status --porcelain=v1 -z -b` and looking items up.

export type GitState = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'ignored' | 'conflict'

export interface GitStatus {
  branch: string | null
  ahead: number
  behind: number
  /** Paths relative to the listed folder ('/'-separated); folders reported whole end with '/'. */
  files: Record<string, GitState>
}

const CONFLICT = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

export function stateOf(xy: string): GitState {
  if (xy === '??') return 'untracked'
  if (xy === '!!') return 'ignored'
  if (CONFLICT.has(xy)) return 'conflict'
  if (xy.includes('R') || xy.includes('C')) return 'renamed'
  if (xy.includes('A')) return 'added'
  if (xy.includes('D')) return 'deleted'
  return 'modified'
}

/**
 * Parses porcelain v1 with -z and -b. `prefix` is the listed folder relative to the repository root
 * (`git rev-parse --show-prefix`, ending with '/' or empty); only paths below it are kept.
 */
export function parseStatus(out: string, prefix: string): GitStatus {
  const result: GitStatus = { branch: null, ahead: 0, behind: 0, files: {} }
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part.length < 3) continue
    if (part.startsWith('## ')) {
      const header = part.slice(3)
      const m = /^(?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(header)
      if (m) {
        result.branch = m[1] === 'HEAD (no branch)' ? 'HEAD' : m[1]
        result.ahead = Number(/ahead (\d+)/.exec(m[3] ?? '')?.[1] ?? 0)
        result.behind = Number(/behind (\d+)/.exec(m[3] ?? '')?.[1] ?? 0)
      }
      continue
    }
    const xy = part.slice(0, 2)
    const file = part.slice(3)
    if (xy.includes('R') || xy.includes('C')) i++ // the next part is the original path
    if (!file.startsWith(prefix)) continue
    const rel = file.slice(prefix.length)
    if (rel) result.files[rel] = stateOf(xy)
  }
  return result
}

/** Which state wins when a folder contains several. */
const WEIGHT: Record<GitState, number> = { ignored: 0, untracked: 1, deleted: 2, renamed: 3, added: 4, modified: 5, conflict: 6 }

/**
 * A lookup for items of the listed folder (and its subfolders, for search results): exact entries,
 * items inside a folder reported whole (untracked or ignored "dir/"), and folders containing changes.
 */
export function gitLookup(status: GitStatus): (rel: string, isDir: boolean) => GitState | null {
  const folders = new Map<string, GitState>()
  for (const [file, state] of Object.entries(status.files)) {
    if (state === 'ignored') continue // an ignored file deep inside does not make its folder interesting
    const segments = file.replace(/\/$/, '').split('/')
    for (let n = 1; n < segments.length; n++) {
      const dir = segments.slice(0, n).join('/')
      const prev = folders.get(dir)
      const folderState = state === 'untracked' ? 'untracked' : 'modified'
      if (!prev || WEIGHT[folderState] > WEIGHT[prev]) folders.set(dir, state === 'conflict' ? 'conflict' : folderState)
    }
  }
  return (rel, isDir) => {
    const exact = status.files[rel] ?? (isDir ? status.files[`${rel}/`] : undefined)
    if (exact) return exact
    // Inside a folder that git reports as a whole (untracked or ignored).
    const segments = rel.split('/')
    for (let n = segments.length - 1; n >= 1; n--) {
      const whole = status.files[`${segments.slice(0, n).join('/')}/`]
      if (whole === 'untracked' || whole === 'ignored') return whole
    }
    return isDir ? (folders.get(rel) ?? null) : null
  }
}

/** The file's version in HEAD, for the change bars and the diff view. */
export interface GitFile {
  /** Null when the file is not tracked yet (or the repository has no commit) – every line is new. */
  base: string | null
}

export interface BlameCommit {
  sha: string
  author: string
  /** Author time in ms. */
  time: number
  summary: string
}

export interface GitBlame {
  commits: Record<string, BlameCommit>
  /** Commit of each line of the working copy, in order. */
  lines: string[]
}

/** Lines changed in the working copy but not committed carry an all-zero sha. */
export const isUncommitted = (sha: string): boolean => /^0+$/.test(sha)

/** Parses `git blame --porcelain`: commit details come only with a commit's first line group. */
export function parseBlame(out: string): GitBlame {
  const result: GitBlame = { commits: {}, lines: [] }
  let commit: BlameCommit | null = null
  for (const line of out.split('\n')) {
    if (line.startsWith('\t')) {
      if (commit) result.lines.push(commit.sha)
      continue
    }
    const header = /^([0-9a-f]{40,64}) \d+ \d+/.exec(line)
    if (header) {
      commit = result.commits[header[1]] ??= { sha: header[1], author: '', time: 0, summary: '' }
      continue
    }
    if (!commit) continue
    const space = line.indexOf(' ')
    const key = line.slice(0, space)
    const value = line.slice(space + 1)
    if (key === 'author') commit.author = value
    else if (key === 'author-time') commit.time = Number(value) * 1000
    else if (key === 'summary') commit.summary = value
  }
  return result
}

export interface LineChange {
  kind: 'added' | 'modified' | 'deleted'
  /** 1-based lines of the new text; a deletion sits on the line above the removed ones (1 at the top). */
  start: number
  end: number
}

/** Beyond this many inserted + deleted lines the texts count as unrelated and no bars are shown. */
const MAX_EDITS = 1500

const splitLines = (s: string): string[] => s.split(/\r\n|\r|\n/)

/**
 * Line changes from base to text, like the change bars in VS Code's gutter. Myers' diff on the part
 * between the common prefix and suffix; null when the texts differ too much to be worth showing.
 */
export function lineChanges(base: string, text: string): LineChange[] | null {
  const a = splitLines(base)
  const b = splitLines(text)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) endA--, endB--
  const n = endA - start
  const m = endB - start
  const limit = Math.min(n + m, MAX_EDITS)
  const off = limit + 1
  const v = new Int32Array(2 * limit + 3)
  // trace[d] holds the furthest x per diagonal k ∈ [-d, d] before step d, indexed k + d.
  const trace: Int32Array[] = []
  let done = false
  for (let d = 0; d <= limit && !done; d++) {
    trace.push(v.slice(off - d, off + d + 1))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[start + x] === b[start + y]) x++, y++
      v[off + k] = x
      if (x >= n && y >= m) {
        done = true
        break
      }
    }
  }
  if (!done) return null

  // Walk back from the end into an edit script: '=' kept, '-' deleted from a, '+' inserted from b.
  const ops: string[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d > 0; d--) {
    const prev = trace[d]
    const k = x - y
    const prevK = k === -d || (k !== d && prev[k - 1 + d] < prev[k + 1 + d]) ? k + 1 : k - 1
    const prevX = prev[prevK + d]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) ops.push('='), x--, y--
    ops.push(x === prevX ? '+' : '-')
    x = prevX
    y = prevY
  }
  ops.reverse()

  const changes: LineChange[] = []
  let line = start // lines of b passed so far
  for (let i = 0; i < ops.length; ) {
    if (ops[i] === '=') {
      line++, i++
      continue
    }
    let dels = 0
    let ins = 0
    for (; i < ops.length && ops[i] !== '='; i++) ops[i] === '-' ? dels++ : ins++
    if (ins) changes.push({ kind: dels ? 'modified' : 'added', start: line + 1, end: line + ins })
    else changes.push({ kind: 'deleted', start: Math.max(line, 1), end: Math.max(line, 1) })
    line += ins
  }
  return changes
}

// ---- source control panel ------------------------------------------------------------------------

/** One changed path of the repository ('/'-separated, relative to the work tree root). */
export interface RepoChange {
  path: string
  /** Original path of a rename or copy. */
  from?: string
  state: GitState
}

export interface RepoCommit {
  hash: string
  short: string
  subject: string
  author: string
  /** Commit time, ms since the epoch. */
  time: number
}

/** An operation git stopped in the middle of; the panel offers continue / skip / abort. */
export type RepoOperation = 'rebase' | 'merge' | 'cherry-pick' | 'revert'

export interface RepoState {
  root: string
  /** Null when HEAD is detached. */
  branch: string | null
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  operation: RepoOperation | null
  staged: RepoChange[]
  unstaged: RepoChange[]
  conflicts: RepoChange[]
  stashes: number
  branches: string[]
  remoteBranches: string[]
  remotes: string[]
  commits: RepoCommit[]
  /** More changes than the panel lists. */
  truncated: boolean
}

export type GitAction =
  | { type: 'stage' | 'unstage' | 'discard'; paths: string[] }
  | { type: 'stageAll' | 'unstageAll' }
  | { type: 'commit'; message: string; amend: boolean }
  | { type: 'fetch' | 'pull' | 'push' }
  | { type: 'rebase'; onto: string }
  | { type: 'continue' | 'skip' | 'abort' }
  | { type: 'checkout'; branch: string }
  | { type: 'createBranch'; name: string }
  | { type: 'stash' | 'stashPop' }
  /** Creates a repository in the folder (the only action outside one). */
  | { type: 'init' }

export const MAX_REPO_CHANGES = 2000

/** The letter shown next to a change, as in `git status --short`. */
export const STATE_LETTER: Record<GitState, string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', ignored: 'I', conflict: '!' }

function stateOfCode(c: string): GitState {
  return c === 'A' ? 'added' : c === 'D' ? 'deleted' : c === 'R' || c === 'C' ? 'renamed' : 'modified'
}

/** Parses `git status --porcelain=v2 -z --branch --show-stash` of the whole repository. */
export function parseRepoStatus(out: string): Pick<RepoState, 'branch' | 'head' | 'upstream' | 'ahead' | 'behind' | 'staged' | 'unstaged' | 'conflicts' | 'stashes' | 'truncated'> {
  const r = { branch: null as string | null, head: null as string | null, upstream: null as string | null, ahead: 0, behind: 0, staged: [] as RepoChange[], unstaged: [] as RepoChange[], conflicts: [] as RepoChange[], stashes: 0, truncated: false }
  const parts = out.split('\0')
  let count = 0
  const add = (list: RepoChange[], change: RepoChange): void => {
    if (count++ >= MAX_REPO_CHANGES) r.truncated = true
    else list.push(change)
  }
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i]
    if (line.startsWith('# ')) {
      const [key, ...rest] = line.slice(2).split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') r.head = value === '(initial)' ? null : value
      else if (key === 'branch.head') r.branch = value === '(detached)' ? null : value
      else if (key === 'branch.upstream') r.upstream = value
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value)
        if (m) [r.ahead, r.behind] = [Number(m[1]), Number(m[2])]
      } else if (key === 'stash') r.stashes = Number(value) || 0
      continue
    }
    const kind = line[0]
    if (kind === '?') add(r.unstaged, { path: line.slice(2), state: 'untracked' })
    else if (kind === 'u') add(r.conflicts, { path: line.split(' ').slice(10).join(' '), state: 'conflict' })
    else if (kind === '1' || kind === '2') {
      const fields = line.split(' ')
      const xy = fields[1]
      // Ordinary entries have 8 fields before the path, renames 9 (plus the original path in the next part).
      const path = fields.slice(kind === '1' ? 8 : 9).join(' ')
      const from = kind === '2' ? parts[++i] : undefined
      if (xy[0] !== '.') add(r.staged, { path, ...(from ? { from } : {}), state: stateOfCode(xy[0]) })
      if (xy[1] !== '.') add(r.unstaged, { path, state: stateOfCode(xy[1]) })
    }
  }
  return r
}

/** Parses `git log --format=%H%x1f%h%x1f%s%x1f%an%x1f%at%x1e`. */
export function parseLog(out: string): RepoCommit[] {
  return out
    .split('\x1e')
    .map((rec) => rec.replace(/^\n/, ''))
    .filter(Boolean)
    .map((rec) => {
      const [hash, short, subject, author, at] = rec.split('\x1f')
      return { hash, short, subject, author, time: Number(at) * 1000 }
    })
}

/** A path from the renderer that may be handed to git after `--`: relative, inside the work tree. */
export function isRepoPath(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && p.length < 4096 && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.includes('\0') && !p.split(/[\\/]/).includes('..')
}

// ---- diffs and the history graph -----------------------------------------------------------------

/** Which two versions of a file a diff compares. */
export type DiffSource =
  /** HEAD ↔ index */
  | { kind: 'staged'; path: string; from?: string }
  /** index ↔ working copy (untracked: nothing ↔ working copy) */
  | { kind: 'unstaged'; path: string; untracked?: boolean }
  /** first parent ↔ commit */
  | { kind: 'commit'; hash: string; path: string; from?: string }

export interface FileDiff {
  original: string
  modified: string
  /** Either side has a NUL byte: no text diff. */
  binary: boolean
  /** Either side is too large to show. */
  tooLarge: boolean
}

export interface GraphCommit {
  hash: string
  short: string
  parents: string[]
  subject: string
  author: string
  /** Commit time, ms since the epoch. */
  time: number
  /** Branches and tags pointing here: "HEAD -> main", "origin/main", "tag: v1.0". */
  refs: string[]
}

export interface CommitDetails {
  hash: string
  parents: string[]
  author: string
  email: string
  time: number
  message: string
  /** Changes against the first parent (everything for a root commit). */
  files: RepoChange[]
}

/** Parses `git log --format=%H%x1f%P%x1f%h%x1f%s%x1f%an%x1f%at%x1f%D%x1e`. */
export function parseGraphLog(out: string): GraphCommit[] {
  return out
    .split('\x1e')
    .map((rec) => rec.replace(/^\n/, ''))
    .filter(Boolean)
    .map((rec) => {
      const [hash, parents, short, subject, author, at, refs] = rec.split('\x1f')
      return { hash, short, parents: parents ? parents.split(' ') : [], subject, author, time: Number(at) * 1000, refs: refs ? refs.split(', ').filter(Boolean) : [] }
    })
}

/** Parses `git diff --name-status -z` (also diff-tree): status, path and, for renames and copies, the new path. */
export function parseNameStatus(out: string): RepoChange[] {
  const parts = out.split('\0').filter((p) => p !== '')
  const files: RepoChange[] = []
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++]
    if (code[0] === 'R' || code[0] === 'C') {
      const from = parts[i++]
      files.push({ path: parts[i++], from, state: 'renamed' })
    } else files.push({ path: parts[i++], state: code[0] === 'A' ? 'added' : code[0] === 'D' ? 'deleted' : 'modified' })
  }
  return files
}

/** One row of the history graph: where the commit's dot sits and which lines pass, join and leave it. */
export interface GraphRow {
  commit: GraphCommit
  /** Lane of the dot. */
  lane: number
  /** Lanes that pass the row untouched. */
  through: number[]
  /** Lanes that end in the dot from above (children of this commit). */
  joins: number[]
  /** Lanes that leave the dot downwards, one per parent. */
  parents: number[]
  /** Lanes in use at this row, for the column width. */
  width: number
}

/**
 * Lanes for `git log --topo-order` output, like `git log --graph`: each lane waits for one commit;
 * a commit takes the leftmost lane waiting for it, its first parent continues there, further parents
 * get a free lane (or join a lane already waiting for them). Lanes never move sideways, so lines stay
 * straight except where they join or leave a dot.
 */
export function layoutGraph(commits: GraphCommit[]): GraphRow[] {
  const lanes: (string | null)[] = []
  const rows: GraphRow[] = []
  const free = (): number => {
    const i = lanes.indexOf(null)
    return i >= 0 ? i : lanes.push(null) - 1
  }
  for (const commit of commits) {
    let lane = lanes.indexOf(commit.hash)
    const joins: number[] = []
    lanes.forEach((h, i) => h === commit.hash && joins.push(i))
    if (lane < 0) lane = free()
    const through = lanes.flatMap((h, i) => (h !== null && h !== commit.hash ? [i] : []))
    for (const i of joins) lanes[i] = null
    const parents: number[] = []
    commit.parents.forEach((parent, n) => {
      // The first parent always continues the commit's lane, even when another lane already waits for
      // it – both then join where it appears. A merged parent joins a waiting lane instead of opening one.
      const waiting = n === 0 ? -1 : lanes.indexOf(parent)
      if (waiting >= 0) return parents.push(waiting)
      const target = n === 0 ? lane : free()
      lanes[target] = parent
      parents.push(target)
    })
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    rows.push({ commit, lane, through, joins, parents, width: Math.max(lanes.length, lane + 1, ...through.map((i) => i + 1), ...joins.map((i) => i + 1)) })
  }
  return rows
}
