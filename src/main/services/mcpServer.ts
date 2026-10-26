// MCP server for AI agents (Claude Code, Codex, Cursor …): aFinder's file operations and what the user is
// looking at, over Streamable HTTP on 127.0.0.1 only, behind a bearer token. Off until the user turns it
// on; tools that change files exist only while the user allows them.

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { BrowserWindow } from 'electron'
import { looksLikeText } from '@shared/preview'
import type { FileEntry, McpStatus, McpView } from '@shared/types'
import type { ActivityInput, ActivityService } from './activityService'
import * as files from './fileSystem'
import { saveText } from './preview'
import type { SearchService } from './searchService'
import { planTransfer, runTransfer } from './transfer'
import * as vfs from './vfs'

export const MCP_DEFAULT_PORT = 47321
const MAX_BODY = 4 * 1024 * 1024
const MAX_READ = 1024 * 1024
/** Remote files are downloaded before they can be read. */
const MAX_REMOTE_READ = 50 * 1024 * 1024

export interface McpDeps {
  search: SearchService
  activity: ActivityService
  /** The focused tab of the focused (or last used) window. */
  view(): McpView | null
  /** Shows the folder (or the file's folder) in a new tab of the frontmost window. */
  open(path: string): Promise<void> | void
  /** Window for dialogs a tool may need (deleting remote files asks first). */
  window(): BrowserWindow | null
  allowWrite(): boolean
  showHidden(): boolean
}

/** The SDK and zod cost ~25 MB in the main process: loaded on the first request, not while the server is off. */
type Sdk = { McpServer: typeof McpServer; Transport: typeof import('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransport; z: typeof import('zod').z }
let sdk: Promise<Sdk> | null = null
const loadSdk = (): Promise<Sdk> =>
  (sdk ??= Promise.all([import('@modelcontextprotocol/sdk/server/mcp.js'), import('@modelcontextprotocol/sdk/server/streamableHttp.js'), import('zod')]).then(
    ([mcp, http, zod]) => ({ McpServer: mcp.McpServer, Transport: http.StreamableHTTPServerTransport, z: zod.z })
  ))

export const newMcpToken = (): string => randomBytes(24).toString('base64url')

export class McpHost {
  private server: Server | null = null
  private status: McpStatus = { enabled: false, running: false, url: null, error: null }
  private token = ''

  constructor(private deps: McpDeps) {}

  info(): McpStatus {
    return this.status
  }

  /** Starts, restarts or stops the server to match the settings. */
  async apply(enabled: boolean, port: number, token: string): Promise<McpStatus> {
    this.token = token
    const url = `http://127.0.0.1:${port}/mcp`
    if (this.server && (!enabled || this.status.url !== url)) await this.stop()
    if (!enabled) return (this.status = { enabled: false, running: false, url: null, error: null })
    if (this.server) return this.status
    const server = createServer((req, res) => void this.handle(req, res, port))
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject)
          resolve()
        })
      })
      this.server = server
      this.status = { enabled: true, running: true, url, error: null }
    } catch (err) {
      this.status = { enabled: true, running: false, url, error: (err as Error).message }
    }
    return this.status
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) return
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handle(req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
    const fail = (status: number, message: string): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
    }
    // A web page must not reach the server: no browser origins, and only our own host name (DNS rebinding).
    if (req.headers.origin) return fail(403, 'Browser requests are not allowed')
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return fail(403, 'Invalid host')
    if (!this.authorized(req.headers.authorization)) return fail(401, 'Missing or wrong bearer token')
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/mcp') return fail(404, 'Not found')
    // Stateless: every POST is a whole exchange; there is no session to stream to or to delete.
    if (req.method !== 'POST') return fail(405, 'Method not allowed')

    let body: unknown
    try {
      body = JSON.parse(await readBody(req))
    } catch (err) {
      return fail(400, (err as Error).message || 'Invalid JSON')
    }
    let loaded: Sdk
    try {
      loaded = await loadSdk()
    } catch (err) {
      sdk = null
      return fail(500, (err as Error).message)
    }
    const mcp = this.build(loaded)
    const transport = new loaded.Transport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      void transport.close()
      void mcp.close()
    })
    try {
      await mcp.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch (err) {
      if (!res.headersSent) fail(500, (err as Error).message)
    }
  }

  private authorized(header: string | undefined): boolean {
    const given = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7).trim() : '')
    const expected = Buffer.from(this.token)
    return expected.length > 0 && given.length === expected.length && timingSafeEqual(given, expected)
  }

  /** A server per request, so the tool list always reflects the current settings. */
  private build({ McpServer, z }: Sdk): McpServer {
    const { deps } = this
    const mcp = new McpServer(
      { name: 'afinder', version: '1.0.0' },
      {
        instructions:
          'aFinder is the file manager the user is looking at. Use get_current_view to learn which folder and files they mean by "here" or "these". ' +
          'All paths are absolute. Deleting moves items to the Trash. Tools that change files are only listed when the user allows them in aFinder settings.'
      }
    )
    const ok = (value: unknown): { content: { type: 'text'; text: string }[] } => ({
      content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
    })
    const tracked = <T>(input: ActivityInput, work: () => Promise<T>, result?: (value: T) => Partial<ActivityInput>): Promise<T> =>
      deps.activity.track({ ...input, label: 'MCP' }, work, result)

    mcp.registerTool(
      'get_current_view',
      {
        title: 'Current folder and selection',
        description: 'The folder shown in the focused aFinder tab and the files the user has selected there.',
        annotations: { readOnlyHint: true }
      },
      async () => ok(deps.view() ?? 'No aFinder window is open.')
    )

    mcp.registerTool(
      'list_directory',
      {
        title: 'List folder',
        description: 'Files and folders in a folder (local, inside an archive, or on a connected remote server).',
        inputSchema: {
          path: z.string().describe('Absolute folder path; ~ is the home folder'),
          showHidden: z.boolean().optional().describe('Include hidden items (default: as set in aFinder)'),
          limit: z.number().int().min(1).max(5000).optional().describe('Maximum entries (default 500)')
        },
        annotations: { readOnlyHint: true }
      },
      async ({ path: dir, showHidden, limit = 500 }) => {
        const listing = await files.list(dir)
        const hidden = showHidden ?? deps.showHidden()
        const entries = listing.entries.filter((e) => hidden || !e.hidden).sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
        return ok({ path: listing.path, readOnly: listing.readOnly === true, total: entries.length, entries: entries.slice(0, limit).map(entryInfo) })
      }
    )

    mcp.registerTool(
      'get_file_info',
      {
        title: 'File info',
        description: 'Type, size and modification time of one file or folder.',
        inputSchema: { path: z.string().describe('Absolute path') },
        annotations: { readOnlyHint: true }
      },
      async ({ path: p }) => {
        const full = files.validatePath(p)
        const listing = await files.list(path.dirname(full))
        const entry = listing.entries.find((e) => e.name === path.basename(full).normalize('NFC'))
        if (!entry) throw new Error(`Not found: ${full}`)
        return ok(entryInfo(entry))
      }
    )

    mcp.registerTool(
      'read_text_file',
      {
        title: 'Read text file',
        description: 'Text content of a file, in pages. Binary files are refused.',
        inputSchema: {
          path: z.string().describe('Absolute file path'),
          offset: z.number().int().min(0).optional().describe('Byte offset to start at (default 0)'),
          maxBytes: z.number().int().min(1).max(MAX_READ).optional().describe('Bytes to read (default 100000)')
        },
        annotations: { readOnlyHint: true }
      },
      async ({ path: p, offset = 0, maxBytes = 100_000 }) => {
        const real = await vfs.realPath(files.validatePath(p), MAX_REMOTE_READ)
        const handle = await fs.open(real, 'r')
        try {
          const { size } = await handle.stat()
          const buf = Buffer.alloc(Math.max(0, Math.min(maxBytes, size - offset)))
          const { bytesRead } = await handle.read(buf, 0, buf.length, offset)
          const bytes = buf.subarray(0, bytesRead)
          if (!looksLikeText(new Uint8Array(bytes.subarray(0, 8192)))) throw new Error('This looks like a binary file, not text.')
          const end = offset + bytesRead
          return ok({ path: p, size, offset, nextOffset: end < size ? end : null, text: bytes.toString('utf8') })
        } finally {
          await handle.close()
        }
      }
    )

    mcp.registerTool(
      'search_files',
      {
        title: 'Find files',
        description: 'Files and folders under a folder whose names contain the query (ignoring case and accents), like the aFinder filter.',
        inputSchema: {
          root: z.string().describe('Absolute folder to search in, recursively'),
          query: z.string().min(1).describe('Part of the name, e.g. "invoice" or ".pdf"'),
          fuzzy: z.boolean().optional().describe('Match the letters in order, not necessarily together ("inv24" finds "invoice-2024")'),
          showHidden: z.boolean().optional(),
          limit: z.number().int().min(1).max(2000).optional().describe('Maximum results (default 200)')
        },
        annotations: { readOnlyHint: true }
      },
      async ({ root, query, fuzzy = false, showHidden, limit = 200 }) => {
        const dir = files.validatePath(root)
        if ((await vfs.locate(dir)).kind !== 'local') throw new Error('Searching works on local folders only.')
        const result = await deps.search.run({ root: dir, query, fuzzy, showHidden: showHidden ?? deps.showHidden() }, limit)
        return ok({ root: dir, truncated: result.truncated, entries: result.entries.map(entryInfo) })
      }
    )

    mcp.registerTool(
      'list_places',
      {
        title: 'Places',
        description: "The user's standard folders, disks and mounted remote servers, as in aFinder's side pane.",
        annotations: { readOnlyHint: true }
      },
      async () => ok(await files.places())
    )

    mcp.registerTool(
      'open_in_afinder',
      {
        title: 'Show in aFinder',
        description: 'Opens a folder (or the folder containing a file) in a new aFinder tab so the user can see it.',
        inputSchema: { path: z.string().describe('Absolute path') },
        annotations: { readOnlyHint: true }
      },
      async ({ path: p }) => {
        await deps.open(files.validatePath(p))
        return ok('Opened.')
      }
    )

    if (!deps.allowWrite()) return mcp

    mcp.registerTool(
      'create_folder',
      {
        title: 'Create folder',
        description: 'Creates a folder (and missing parent folders) on this computer.',
        inputSchema: { path: z.string().describe('Absolute path of the new folder') },
        annotations: { destructiveHint: false, idempotentHint: true }
      },
      async ({ path: p }) => {
        const full = files.validatePath(p)
        await localOnly(full)
        await tracked({ action: 'create', folder: path.dirname(full), paths: [full], count: 1 }, () => fs.mkdir(full, { recursive: true }))
        return ok({ created: full })
      }
    )

    mcp.registerTool(
      'write_text_file',
      {
        title: 'Write text file',
        description: 'Creates a UTF-8 text file, or replaces an existing one when overwrite is true.',
        inputSchema: {
          path: z.string().describe('Absolute file path'),
          content: z.string().max(MAX_BODY),
          overwrite: z.boolean().optional().describe('Replace an existing file (default false)')
        },
        annotations: { destructiveHint: true }
      },
      async ({ path: p, content, overwrite = false }) => {
        const full = files.validatePath(p)
        const exists = await fs.lstat(await vfs.realPath(full, MAX_REMOTE_READ)).then(() => true, () => false)
        if (exists && !overwrite) throw new Error(`Already exists: ${full}. Pass overwrite: true to replace it.`)
        if (exists) {
          await tracked({ action: 'edit', folder: path.dirname(full), paths: [full] }, () => saveText(full, content, null, false, true))
        } else {
          await localOnly(full)
          await tracked({ action: 'create', folder: path.dirname(full), paths: [full], count: 1 }, () => fs.writeFile(full, content, { encoding: 'utf8', flag: 'wx' }))
        }
        return ok({ written: full, bytes: Buffer.byteLength(content) })
      }
    )

    mcp.registerTool(
      'rename',
      {
        title: 'Rename',
        description: 'Renames a file or folder in place (use transfer to move it elsewhere).',
        inputSchema: { path: z.string().describe('Absolute path'), newName: z.string().min(1).describe('New name, without a folder') },
        annotations: { destructiveHint: false }
      },
      async ({ path: p, newName }) => {
        const to = await tracked({ action: 'rename', folder: path.dirname(p), paths: [p] }, () => files.rename(p, newName), (to) => ({ destinations: [to] }))
        return ok({ renamed: to })
      }
    )

    mcp.registerTool(
      'transfer',
      {
        title: 'Copy or move',
        description: 'Copies or moves files and folders into a destination folder (local, or a connected remote server).',
        inputSchema: {
          sources: z.array(z.string()).min(1).max(1000).describe('Absolute paths to copy or move'),
          destination: z.string().describe('Absolute destination folder'),
          mode: z.enum(['copy', 'move']),
          onConflict: z.enum(['keepBoth', 'skip', 'replace']).optional().describe('When a name exists in the destination (default keepBoth; replace moves the old item to the Trash)')
        },
        annotations: { destructiveHint: true }
      },
      async ({ sources, destination, mode, onConflict = 'keepBoth' }) => {
        const plan = await planTransfer({ sources, dest: destination, mode })
        const created = await tracked(
          { action: plan.mode, folder: plan.dest, paths: plan.sources, destinations: [plan.dest] },
          () => runTransfer(plan, onConflict, { cancelled: false }, () => {}),
          (created) => ({ destinations: created, count: created.length })
        )
        return ok({ mode: plan.mode, created })
      }
    )

    mcp.registerTool(
      'move_to_trash',
      {
        title: 'Move to Trash',
        description: 'Moves files and folders to the Trash. Deleting on a remote server asks the user to confirm in aFinder.',
        inputSchema: { paths: z.array(z.string()).min(1).max(1000).describe('Absolute paths') },
        annotations: { destructiveHint: true }
      },
      async ({ paths }) => {
        await tracked({ action: 'trash', paths, count: paths.length }, () => files.trash(paths, deps.window()))
        return ok({ trashed: paths.length })
      }
    )

    return mcp
  }
}

function entryInfo(e: FileEntry): Record<string, unknown> {
  return {
    name: e.name,
    path: e.path,
    type: e.isDir ? 'folder' : 'file',
    kind: e.kind,
    size: e.size,
    modified: new Date(e.modified).toISOString(),
    ...(e.isSymlink ? { symlink: true } : {}),
    ...(e.hidden ? { hidden: true } : {})
  }
}

async function localOnly(p: string): Promise<void> {
  if ((await vfs.locate(p)).kind !== 'local') throw new Error('This works on local files only.')
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('Request too large'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
