import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  BrowserWindow: {},
  dialog: {},
  shell: { trashItem: vi.fn(async () => {}) },
  nativeImage: {},
  protocol: {}
}))

const { McpHost } = await import('./mcpServer')
const { shell } = await import('electron')

const PORT = 47391
const TOKEN = 'test-token-1234567890'
const URL_ = `http://127.0.0.1:${PORT}/mcp`

let dir: string
let host: InstanceType<typeof McpHost>
let allowWrite = false
const opened: string[] = []

async function connect(token = TOKEN): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(URL_), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return client
}

const text = (result: unknown): string => ((result as { content: { text: string }[] }).content[0].text)
const json = (result: unknown): Record<string, unknown> => JSON.parse(text(result))

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'afinder-mcp-'))
  await writeFile(path.join(dir, 'notes.txt'), 'hello from aFinder\n')
  await writeFile(path.join(dir, 'blob.bin'), Buffer.from([0, 1, 2, 3, 0, 0, 255]))
  allowWrite = false
  opened.length = 0
  host = new McpHost({
    search: { run: async () => ({ entries: [], truncated: false }) } as never,
    activity: { track: (_input: unknown, work: () => unknown) => work() } as never,
    view: () => ({ folder: dir, selection: [path.join(dir, 'notes.txt')] }),
    open: (p) => void opened.push(p),
    window: () => null,
    allowWrite: () => allowWrite,
    showHidden: () => false
  })
  const status = await host.apply(true, PORT, TOKEN)
  expect(status.running).toBe(true)
})

afterEach(async () => {
  await host.stop()
  await rm(dir, { recursive: true, force: true })
})

describe('MCP server', () => {
  it('refuses requests without the token, from browsers and to other hosts', async () => {
    await expect(connect('wrong')).rejects.toThrow()
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
    expect((await fetch(URL_, { method: 'POST', body, headers: { ...headers, Origin: 'https://evil.example' } })).status).toBe(403)
    // fetch() drops a custom Host header, so DNS rebinding is simulated with node:http.
    const rebound = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: PORT, path: '/mcp', method: 'POST', headers: { ...headers, Host: `evil.example:${PORT}` } }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end(body)
    })
    expect(rebound).toBe(403)
  })

  it('offers read-only tools until writing is allowed', async () => {
    const client = await connect()
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain('get_current_view')
    expect(names).toContain('read_text_file')
    expect(names).not.toContain('write_text_file')
    await client.close()

    allowWrite = true
    const writer = await connect()
    expect((await writer.listTools()).tools.map((t) => t.name)).toEqual(expect.arrayContaining(['write_text_file', 'transfer', 'move_to_trash']))
    await writer.close()
  })

  it('reports the view, lists, reads text and refuses binary files', async () => {
    const client = await connect()
    expect(json(await client.callTool({ name: 'get_current_view', arguments: {} }))).toEqual({ folder: dir, selection: [path.join(dir, 'notes.txt')] })
    const listing = json(await client.callTool({ name: 'list_directory', arguments: { path: dir } }))
    expect((listing.entries as { name: string }[]).map((e) => e.name)).toEqual(['blob.bin', 'notes.txt'])
    const read = json(await client.callTool({ name: 'read_text_file', arguments: { path: path.join(dir, 'notes.txt'), offset: 5, maxBytes: 5 } }))
    expect(read).toMatchObject({ text: ' from', nextOffset: 10, size: 19 })
    const binary = await client.callTool({ name: 'read_text_file', arguments: { path: path.join(dir, 'blob.bin') } })
    expect(binary.isError).toBe(true)
    await client.callTool({ name: 'open_in_afinder', arguments: { path: dir } })
    expect(opened).toEqual([dir])
    await client.close()
  })

  it('writes, refuses to overwrite by default, renames and trashes', async () => {
    allowWrite = true
    const client = await connect()
    const file = path.join(dir, 'sub', 'new.md')
    await client.callTool({ name: 'create_folder', arguments: { path: path.join(dir, 'sub') } })
    await client.callTool({ name: 'write_text_file', arguments: { path: file, content: '# hi' } })
    expect(await readFile(file, 'utf8')).toBe('# hi')
    expect((await client.callTool({ name: 'write_text_file', arguments: { path: file, content: 'x' } })).isError).toBe(true)
    await client.callTool({ name: 'write_text_file', arguments: { path: file, content: 'replaced', overwrite: true } })
    expect(await readFile(file, 'utf8')).toBe('replaced')
    const renamed = json(await client.callTool({ name: 'rename', arguments: { path: file, newName: 'done.md' } }))
    expect(renamed.renamed).toBe(path.join(dir, 'sub', 'done.md'))
    await client.callTool({ name: 'move_to_trash', arguments: { paths: [path.join(dir, 'sub', 'done.md')] } })
    expect(shell.trashItem).toHaveBeenCalledWith(path.join(dir, 'sub', 'done.md'))
    await client.close()
  })
})
