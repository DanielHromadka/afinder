// Machine stats and the BTC price for the theme field of the status bar.

import { statfs } from 'node:fs/promises'
import os from 'node:os'
import { net } from 'electron'
import type { BtcQuote, SystemInfo } from '@shared/types'
import * as vfs from './vfs'

interface CpuSample {
  idle: number
  total: number
}

function sampleCpu(): CpuSample {
  let idle = 0
  let total = 0
  for (const cpu of os.cpus()) {
    const t = cpu.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.irq + t.idle
  }
  return { idle, total }
}

// Load is measured between two calls; the first call has nothing to compare with.
let lastCpu: CpuSample | null = null

function cpuLoad(): number | null {
  const now = sampleCpu()
  const prev = lastCpu
  lastCpu = now
  if (!prev || now.total <= prev.total) return null
  return 1 - (now.idle - prev.idle) / (now.total - prev.total)
}

async function disk(dir: string): Promise<{ free: number; total: number } | null> {
  try {
    if (await vfs.isVirtual(dir)) return null
    const s = await statfs(dir)
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize }
  } catch {
    // Archives and remote mounts are virtual folders without a disk of their own.
    return null
  }
}

export async function info(dir: string): Promise<SystemInfo> {
  const d = await disk(dir)
  let user = ''
  try {
    user = os.userInfo().username
  } catch {
    // No passwd entry (some containers): leave the name out.
  }
  return {
    cpu: cpuLoad(),
    memUsed: os.totalmem() - os.freemem(),
    memTotal: os.totalmem(),
    uptime: os.uptime(),
    user,
    host: os.hostname().replace(/\.local$/, ''),
    diskFree: d?.free ?? null,
    diskTotal: d?.total ?? null
  }
}

// Markets rather than simple/price: the same single request also carries the seven-day change.
const BTC_URL = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin&price_change_percentage=7d'
const BTC_TTL = 5 * 60_000

let btc: { quote: BtcQuote; at: number } | null = null
let pending: Promise<BtcQuote | null> | null = null

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** One request for all windows at most every five minutes; the last known quote while offline. */
export function btcPrice(): Promise<BtcQuote | null> {
  if (btc && Date.now() - btc.at < BTC_TTL) return Promise.resolve(btc.quote)
  pending ??= (async () => {
    try {
      const res = await net.fetch(BTC_URL, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) return btc?.quote ?? null
      const row = ((await res.json()) as { current_price?: unknown; price_change_percentage_7d_in_currency?: unknown }[])?.[0]
      if (!row || !finite(row.current_price)) return btc?.quote ?? null
      const change = row.price_change_percentage_7d_in_currency
      btc = { quote: { price: row.current_price, change7d: finite(change) ? change : null }, at: Date.now() }
      return btc.quote
    } catch {
      return btc?.quote ?? null
    } finally {
      pending = null
    }
  })()
  return pending
}
