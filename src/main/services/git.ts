// Git status of a folder for the file list. Runs the git binary (never through a shell) with a
// timeout; folders outside a repository, or machines without git, simply get no status.

import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { isRepoPath, parseBlame, parseGraphLog, parseLog, parseNameStatus, parseRepoStatus, parseStatus, type CommitDetails, type DiffSource, type FileDiff, type GitAction, type GitBlame, type GitFile, type GitStatus, type GraphCommit, type RepoOperation, type RepoState } from '@shared/git'
import { isVirtual } from './vfs'
import { validatePath } from './fileSystem'

const TIMEOUT_MS = 8000

function run(file: string, args: string[], cwd?: string, timeout = TIMEOUT_MS, env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd, timeout, env, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout)
      // Git explains what went wrong on stderr ("rejected", "conflict", "Authentication failed").
      const message = String(stderr || stdout).trim() || err.message
      reject(Object.assign(new Error(message), { code: (err as NodeJS.ErrnoException).code }))
    })
  })
}

let binary: Promise<string | null> | null = null

/**
 * Apps started from the Dock do not get the shell's PATH, so Homebrew's git is looked up directly.
 * /usr/bin/git on macOS is only a stub that offers to install the developer tools when they are
 * missing – it is used only when `xcode-select -p` says they are installed.
 */
function findGit(): Promise<string | null> {
  binary ??= (async () => {
    if (process.platform === 'darwin') {
      for (const candidate of ['/opt/homebrew/bin/git', '/usr/local/bin/git']) {
        if (await access(candidate).then(() => true, () => false)) return candidate
      }
      return (await run('/usr/bin/xcode-select', ['-p']).then(() => true, () => false)) ? '/usr/bin/git' : null
    }
    return (await run('git', ['--version']).then(() => true, () => false)) ? 'git' : null
  })()
  return binary
}

/** Status of the folder's repository, limited to the folder; null outside a repository. */
export async function status(dirPath: unknown): Promise<GitStatus | null> {
  const dir = validatePath(dirPath)
  if (await isVirtual(dir)) return null
  const git = await findGit()
  if (!git) return null
  let prefix: string
  try {
    // --show-prefix is the folder relative to the work tree; it fails outside one (and inside .git).
    prefix = (await run(git, ['rev-parse', '--show-prefix'], dir)).trim()
  } catch {
    return null
  }
  const out = await run(
    git,
    ['-c', 'core.quotepath=off', '--no-optional-locks', 'status', '--porcelain=v1', '-z', '-b', '--ignored=matching', '--untracked-files=normal', '--', '.'],
    dir
  )
  // Paths in porcelain output are relative to the repository root, whatever the working directory.
  return parseStatus(out, prefix)
}

/** The git binary, the file's folder and its name – null for virtual paths and outside a work tree. */
async function locate(filePath: unknown): Promise<{ git: string; dir: string; name: string } | null> {
  const file = validatePath(filePath)
  if (await isVirtual(file)) return null
  const git = await findGit()
  if (!git) return null
  const dir = dirname(file)
  try {
    await run(git, ['rev-parse', '--show-prefix'], dir)
  } catch {
    return null
  }
  return { git, dir, name: basename(file) }
}

/** The file's HEAD version for the preview's change bars and diff; null outside a repository or for ignored files. */
export async function file(filePath: unknown): Promise<GitFile | null> {
  const at = await locate(filePath)
  if (!at) return null
  try {
    // "HEAD:./name" is relative to the working directory, so no repository-relative path is needed.
    const base = await run(at.git, ['--no-optional-locks', 'show', `HEAD:./${at.name}`], at.dir)
    return { base: base.replace(/^\uFEFF/, '') } // the preview's decoder drops the BOM as well
  } catch {
    // Not in HEAD: a new file shows all lines as added – unless git ignores it, then it is not git's business.
    const ignored = await run(at.git, ['check-ignore', '-q', '--', at.name], at.dir).then(() => true, () => false)
    return ignored ? null : { base: null }
  }
}

/** Who last changed each line of the working copy; null outside a repository or for untracked files. */
export async function blame(filePath: unknown): Promise<GitBlame | null> {
  const at = await locate(filePath)
  if (!at) return null
  try {
    return parseBlame(await run(at.git, ['--no-optional-locks', 'blame', '--porcelain', '--', at.name], at.dir))
  } catch {
    return null
  }
}

// ---- source control panel ------------------------------------------------------------------------

/** Work tree root of the folder's repository and the git binary; null for virtual folders or outside a repository. */
async function repoOf(dirPath: unknown): Promise<{ git: string; root: string } | null> {
  const dir = validatePath(dirPath)
  if (await isVirtual(dir)) return null
  const git = await findGit()
  if (!git) return null
  try {
    return { git, root: (await run(git, ['rev-parse', '--show-toplevel'], dir)).trim() }
  } catch {
    return null
  }
}

/** The operation git is in the middle of, from the marker files in the git directory (worktree-aware). */
async function operationOf(git: string, root: string): Promise<RepoOperation | null> {
  const markers: [string, RepoOperation][] = [['rebase-merge', 'rebase'], ['rebase-apply', 'rebase'], ['MERGE_HEAD', 'merge'], ['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert']]
  const paths = (await run(git, ['rev-parse', ...markers.flatMap(([m]) => ['--git-path', m])], root)).trim().split('\n')
  for (let i = 0; i < markers.length; i++) {
    const p = isAbsolute(paths[i]) ? paths[i] : join(root, paths[i])
    if (await access(p).then(() => true, () => false)) return markers[i][1]
  }
  return null
}

/** Everything the source control panel shows about the folder's repository; null outside one. */
export async function repo(dirPath: unknown): Promise<RepoState | null> {
  const at = await repoOf(dirPath)
  if (!at) return null
  const { git, root } = at
  const refs = (pattern: string): Promise<string[]> =>
    run(git, ['for-each-ref', '--format=%(refname:short)', '--sort=-committerdate', pattern], root).then((out) => out.split('\n').filter((b) => b && !b.endsWith('/HEAD')), () => [])
  const [status, operation, branches, remoteBranches, remotes, log] = await Promise.all([
    run(git, ['-c', 'core.quotepath=off', '--no-optional-locks', 'status', '--porcelain=v2', '-z', '--branch', '--show-stash', '--untracked-files=all'], root),
    operationOf(git, root),
    refs('refs/heads'),
    refs('refs/remotes'),
    run(git, ['remote'], root).then((out) => out.split('\n').filter(Boolean), () => []),
    // Fails in a repository without commits.
    run(git, ['--no-optional-locks', 'log', '-n', '30', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%at%x1e'], root).catch(() => '')
  ])
  return { root, operation, branches, remoteBranches, remotes, commits: parseLog(log), ...parseRepoStatus(status) }
}

const NETWORK_TIMEOUT_MS = 120_000

/**
 * Git never waits for input here: credentials come from the configured helper or ssh agent, editors
 * (rebase --continue, merge messages) accept the prepared message as it is.
 */
function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes', GCM_INTERACTIVE: 'never' }
}

const paths = (list: unknown): string[] => {
  if (!Array.isArray(list) || list.length === 0 || !list.every(isRepoPath)) throw new Error('Invalid path')
  return list
}

/** Runs one source control action in the folder's repository; returns what git printed. */
export async function action(dirPath: unknown, a: GitAction): Promise<string> {
  if (a?.type === 'init') {
    const dir = validatePath(dirPath)
    const git = await findGit()
    if (!git || (await isVirtual(dir))) throw new Error('Git is not available here')
    return run(git, ['init'], dir)
  }
  const at = await repoOf(dirPath)
  if (!at) throw new Error('Not a git repository')
  const { git, root } = at
  const env = gitEnv()
  const g = (args: string[], timeout = 60_000): Promise<string> => run(git, args, root, timeout, env)
  const state = async (): Promise<RepoState> => (await repo(root))!
  const ref = async (name: unknown): Promise<string> => {
    if (typeof name !== 'string' || name.startsWith('-')) throw new Error('Invalid branch name')
    await g(['check-ref-format', '--allow-onelevel', `refs/heads/${name}`]).catch(() => g(['check-ref-format', `refs/remotes/${name}`]))
    return name
  }
  switch (a?.type) {
    case 'stage':
      return g(['add', '-A', '--', ...paths(a.paths)])
    case 'stageAll':
      return g(['add', '-A'])
    case 'unstage': {
      const s = await state()
      // Before the first commit there is no HEAD to reset to.
      return s.head ? g(['reset', '-q', 'HEAD', '--', ...paths(a.paths)]) : g(['rm', '-q', '--cached', '--', ...paths(a.paths)])
    }
    case 'unstageAll':
      return (await state()).head ? g(['reset', '-q']) : g(['rm', '-r', '-q', '--cached', '.'])
    case 'discard': {
      const list = paths(a.paths)
      const s = await state()
      const untracked = new Set(s.unstaged.filter((c) => c.state === 'untracked').map((c) => c.path))
      const tracked = list.filter((p) => !untracked.has(p))
      const fresh = list.filter((p) => untracked.has(p))
      if (tracked.length) await g(['checkout', '--', ...tracked])
      if (fresh.length) await g(['clean', '-f', '-q', '--', ...fresh])
      return ''
    }
    case 'commit': {
      if (typeof a.message !== 'string' || (!a.message.trim() && !a.amend)) throw new Error('Empty commit message')
      return g(['commit', ...(a.amend ? ['--amend'] : []), ...(a.message.trim() ? ['-m', a.message] : ['--no-edit'])])
    }
    case 'fetch':
      return g(['fetch', '--all', '--prune'], NETWORK_TIMEOUT_MS)
    case 'pull':
      return g(['pull', '--no-edit'], NETWORK_TIMEOUT_MS)
    case 'push': {
      const s = await state()
      if (s.upstream || !s.branch) return g(['push'], NETWORK_TIMEOUT_MS)
      // A new branch: publish it to the only (or "origin") remote and track it.
      const remote = s.remotes.includes('origin') ? 'origin' : s.remotes[0]
      if (!remote) throw new Error('No remote repository is configured')
      return g(['push', '-u', remote, 'HEAD'], NETWORK_TIMEOUT_MS)
    }
    case 'rebase':
      return g(['rebase', await ref(a.onto)])
    case 'continue':
    case 'skip':
    case 'abort': {
      const op = (await state()).operation
      if (!op) throw new Error('No operation in progress')
      if (a.type === 'skip' && op !== 'rebase' && op !== 'cherry-pick' && op !== 'revert') throw new Error('Cannot skip')
      // A merge continues by committing the resolved result.
      if (op === 'merge' && a.type === 'continue') return g(['commit', '--no-edit'])
      return g([op, `--${a.type}`])
    }
    case 'checkout':
      return g(['checkout', await ref(a.branch)])
    case 'createBranch':
      return g(['checkout', '-b', await ref(a.name)])
    case 'stash':
      return g(['stash', 'push', '--include-untracked'])
    case 'stashPop':
      return g(['stash', 'pop'])
    default:
      throw new Error('Unknown git action')
  }
}

// ---- diffs and the history graph -----------------------------------------------------------------

/** Each side of a diff is capped; beyond it the panel says the file is too large. */
const MAX_DIFF_BYTES = 4 * 1024 * 1024
const MAX_GRAPH_COMMITS = 5000

const isHash = (h: unknown): h is string => typeof h === 'string' && /^[0-9a-f]{4,64}$/i.test(h)

/** Runs git and returns stdout as raw bytes; null when it fails (no such revision or path). */
function bytes(git: string, args: string[], cwd: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile(git, args, { cwd, timeout: TIMEOUT_MS, encoding: 'buffer', maxBuffer: MAX_DIFF_BYTES + 1, windowsHide: true }, (err, stdout) => resolve(err ? null : stdout))
  })
}

/** The two versions of a changed file: HEAD, the index, the working copy or a commit and its first parent. */
export async function diff(dirPath: unknown, source: DiffSource): Promise<FileDiff> {
  const at = await repoOf(dirPath)
  if (!at) throw new Error('Not a git repository')
  const { git, root } = at
  if (!source || !isRepoPath(source.path) || ('from' in source && source.from !== undefined && !isRepoPath(source.from))) throw new Error('Invalid path')
  const show = (spec: string): Promise<Buffer | null> => bytes(git, ['--no-optional-locks', 'show', spec], root)
  const from = ('from' in source && source.from) || source.path
  let sides: [Buffer | null, Buffer | null]
  if (source.kind === 'staged') sides = await Promise.all([show(`HEAD:${from}`), show(`:${source.path}`)])
  else if (source.kind === 'unstaged') {
    const file = join(root, ...source.path.split('/'))
    const working = readFile(file).then((b) => (b.length > MAX_DIFF_BYTES ? Buffer.alloc(MAX_DIFF_BYTES + 1) : b), () => null)
    sides = await Promise.all([source.untracked ? null : show(`:${source.path}`), working])
  } else {
    if (!isHash(source.hash)) throw new Error('Invalid commit')
    const parent = (await run(git, ['rev-list', '--parents', '-n', '1', source.hash], root)).trim().split(' ')[1]
    sides = await Promise.all([parent ? show(`${parent}:${from}`) : null, show(`${source.hash}:${source.path}`)])
  }
  const tooLarge = sides.some((b) => b !== null && b.length > MAX_DIFF_BYTES)
  const binary = !tooLarge && sides.some((b) => b !== null && b.subarray(0, 8000).includes(0))
  const text = (b: Buffer | null): string => (b && !tooLarge && !binary ? b.toString('utf8').replace(/^\uFEFF/, '') : '')
  return { original: text(sides[0]), modified: text(sides[1]), binary, tooLarge }
}

/** Commits for the graph: one branch (or other ref), or all branches, remotes and tags when ref is null. */
export async function graph(dirPath: unknown, ref: unknown, limit: unknown): Promise<GraphCommit[]> {
  const at = await repoOf(dirPath)
  if (!at) return []
  const { git, root } = at
  const n = Math.min(MAX_GRAPH_COMMITS, Math.max(1, Math.floor(Number(limit) || 400)))
  let revs = ['--branches', '--remotes', '--tags', 'HEAD']
  if (ref !== null) {
    if (typeof ref !== 'string' || !ref || ref.startsWith('-')) throw new Error('Invalid branch name')
    revs = [(await run(git, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], root)).trim()]
  }
  // A repository without commits has nothing to show (HEAD does not resolve yet).
  const out = await run(git, ['--no-optional-locks', 'log', '--topo-order', '-n', String(n), '--format=%H%x1f%P%x1f%h%x1f%s%x1f%an%x1f%at%x1f%D%x1e', ...revs, '--'], root).catch(() => '')
  return parseGraphLog(out)
}

/** Message, author and changed files of one commit. */
export async function commitDetails(dirPath: unknown, hash: unknown): Promise<CommitDetails> {
  const at = await repoOf(dirPath)
  if (!at) throw new Error('Not a git repository')
  if (!isHash(hash)) throw new Error('Invalid commit')
  const { git, root } = at
  const head = await run(git, ['--no-optional-locks', 'show', '-s', '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%B', hash], root)
  const [full, parents, author, email, time, ...message] = head.split('\x1f')
  const parentList = parents ? parents.split(' ') : []
  // Merges against their first parent, like the history in most tools; root commits against nothing.
  const files = await run(
    git,
    parentList.length
      ? ['-c', 'core.quotepath=off', '--no-optional-locks', 'diff', '--name-status', '-z', '-M', parentList[0], full]
      : ['-c', 'core.quotepath=off', '--no-optional-locks', 'diff-tree', '--root', '-r', '--no-commit-id', '--name-status', '-z', '-M', full],
    root
  )
  return { hash: full, parents: parentList, author, email, time: Number(time) * 1000, message: message.join('\x1f').trim(), files: parseNameStatus(files) }
}
