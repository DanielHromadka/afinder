import { describe, expect, it } from 'vitest'
import { cpuPercent, groupContainers, isContainerRef, isImageRef, LogDecoder, mapContainer, mapPorts, memUsage, parseDockerHost, splitImageRef, statsPoint, stripAnsi } from './docker'

const frame = (stream: 1 | 2, text: string): Uint8Array => {
  const body = new TextEncoder().encode(text)
  const out = new Uint8Array(8 + body.length)
  out[0] = stream
  new DataView(out.buffer).setUint32(4, body.length)
  out.set(body, 8)
  return out
}

describe('docker log decoder', () => {
  it('splits framed stdout and stderr into whole lines, across chunk and frame boundaries', () => {
    const d = new LogDecoder(false)
    const bytes = new Uint8Array([...frame(1, 'one\ntw'), ...frame(2, 'oops\n'), ...frame(1, 'o\n')])
    expect(d.push(bytes.subarray(0, 5))).toEqual([])
    expect(d.push(bytes.subarray(5, 20))).toEqual([{ stream: 'stdout', text: 'one' }])
    expect(d.push(bytes.subarray(20))).toEqual([
      { stream: 'stderr', text: 'oops' },
      { stream: 'stdout', text: 'two' }
    ])
  })

  it('reads a TTY stream raw, strips colours and keeps a last unterminated line for flush', () => {
    const d = new LogDecoder(true)
    expect(d.push(new TextEncoder().encode('\x1b[32mready\x1b[0m\r\nhalf'))).toEqual([{ stream: 'stdout', text: 'ready' }])
    expect(d.flush()).toEqual([{ stream: 'stdout', text: 'half' }])
  })

  it('keeps multi-byte characters split between chunks', () => {
    const d = new LogDecoder(true)
    const bytes = new TextEncoder().encode('žluťoučký\n')
    expect(d.push(bytes.subarray(0, 1))).toEqual([])
    expect(d.push(bytes.subarray(1))).toEqual([{ stream: 'stdout', text: 'žluťoučký' }])
  })
})

describe('docker stats', () => {
  const raw = {
    read: '2026-01-01T00:00:01Z',
    cpu_stats: { cpu_usage: { total_usage: 400 }, system_cpu_usage: 2000, online_cpus: 4 },
    precpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 1000 },
    memory_stats: { usage: 1000, limit: 4000, stats: { inactive_file: 300 } },
    networks: { eth0: { rx_bytes: 5000, tx_bytes: 1000 } },
    blkio_stats: { io_service_bytes_recursive: [{ op: 'read', value: 100 }, { op: 'Write', value: 50 }] }
  }

  it('computes CPU like docker stats, memory without the page cache', () => {
    expect(cpuPercent(raw)).toBe(80)
    expect(cpuPercent(raw, { total: 400, system: 2000 })).toBe(0)
    expect(memUsage(raw)).toBe(700)
  })

  it('turns totals into rates per second between readings', () => {
    const prev = { ...raw, read: '2026-01-01T00:00:00Z', networks: { eth0: { rx_bytes: 1000, tx_bytes: 0 } }, blkio_stats: { io_service_bytes_recursive: [] } }
    const p = statsPoint(raw, prev)
    expect(p).toMatchObject({ cpu: 80, mem: 700, memLimit: 4000, netRx: 4000, netTx: 1000, blkRead: 100, blkWrite: 50 })
    expect(statsPoint({ ...raw, networks: undefined, blkio_stats: { io_service_bytes_recursive: null } }, null)).toMatchObject({ netRx: null, blkRead: null })
  })
})

describe('docker containers', () => {
  it('maps the engine list, ports once each and compose labels', () => {
    const c = mapContainer({
      Id: 'abc123',
      Names: ['/web-1'],
      State: 'running',
      Ports: [
        { PrivatePort: 80, PublicPort: 8080, IP: '0.0.0.0', Type: 'tcp' },
        { PrivatePort: 80, PublicPort: 8080, IP: '::', Type: 'tcp' },
        { PrivatePort: 443, Type: 'tcp' }
      ],
      Labels: { 'com.docker.compose.project': 'shop', 'com.docker.compose.service': 'web', 'com.docker.compose.project.config_files': '/p/compose.yaml,/p/compose.override.yaml' },
      Mounts: [{ Type: 'volume', Name: 'data' }, { Type: 'bind' }],
      NetworkSettings: { Networks: { shop_default: {} } }
    })
    expect(c).toMatchObject({ name: 'web-1', project: 'shop', service: 'web', volumes: ['data'], networks: ['shop_default'] })
    expect(c.ports).toEqual([
      { private: 80, public: 8080, ip: '0.0.0.0', type: 'tcp' },
      { private: 443, public: null, ip: null, type: 'tcp' }
    ])
    expect(c.configFiles).toEqual(['/p/compose.yaml', '/p/compose.override.yaml'])
    expect(mapPorts(null)).toEqual([])
  })

  it('groups compose projects first, loose containers last', () => {
    const mk = (name: string, project: string | null): ReturnType<typeof mapContainer> => ({ ...mapContainer({ Id: name, Names: [`/${name}`] }), project })
    expect(groupContainers([mk('solo', null), mk('b', 'zeta'), mk('a', 'alpha')]).map((g) => g.project)).toEqual(['alpha', 'zeta', null])
  })
})

describe('docker references', () => {
  it('accepts ids, names and image references, nothing that escapes a path segment', () => {
    expect(isContainerRef('3f2a9c')).toBe(true)
    expect(isContainerRef('shop-web-1')).toBe(true)
    expect(isContainerRef('../etc')).toBe(false)
    expect(isContainerRef('a/b')).toBe(false)
    expect(isImageRef('ghcr.io/org/app:1.2')).toBe(true)
    expect(isImageRef('sha256:abc')).toBe(true)
    expect(isImageRef('a/../b')).toBe(false)
    expect(isImageRef('-rm')).toBe(false)
  })

  it('splits image references so a pull never fetches every tag', () => {
    expect(splitImageRef('nginx')).toEqual({ image: 'nginx', tag: 'latest' })
    expect(splitImageRef('localhost:5000/app')).toEqual({ image: 'localhost:5000/app', tag: 'latest' })
    expect(splitImageRef('redis:7-alpine')).toEqual({ image: 'redis', tag: '7-alpine' })
    expect(splitImageRef('app@sha256:ff')).toEqual({ image: 'app', tag: 'sha256:ff' })
  })

  it('parses DOCKER_HOST and strips terminal colours', () => {
    expect(parseDockerHost('unix:///var/run/docker.sock')).toEqual({ socketPath: '/var/run/docker.sock' })
    expect(parseDockerHost('npipe:////./pipe/docker_engine')).toEqual({ socketPath: '\\\\.\\pipe\\docker_engine' })
    expect(parseDockerHost('tcp://10.0.0.2:2376')).toEqual({ host: '10.0.0.2', port: 2376 })
    expect(parseDockerHost('ssh://box')).toBeNull()
    expect(stripAnsi('\x1b[1;31merror\x1b[0m')).toBe('error')
  })
})
