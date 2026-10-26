// Status of the background services shown in the settings (MCP, phone companion, feedback, remote desktop).

import type { DeviceKind } from '../companion/crypto'
import type { HostInfo, ScreenDisplay } from '../companion/protocol'

/** The local MCP server, for the settings dialog. */
export interface McpStatus {
  enabled: boolean
  running: boolean
  /** Endpoint, e.g. http://127.0.0.1:47321/mcp; null while off. */
  url: string | null
  /** Why it could not start (port in use …). */
  error: string | null
}

/** A phone or another aFinder paired with this computer. */
export interface CompanionDevice {
  /** Its public key (base64url). */
  id: string
  name: string
  /** Phones and other computers are listed, allowed and switched on separately (Settings → Phone / Remote access). */
  kind: DeviceKind
  pairedAt: number
  lastSeen: number | null
  /** May create, upload, rename and trash files. */
  write: boolean
  /** May watch the screen whenever it wants (unattended: no confirmation on the computer). */
  screen: boolean
  /** May also use the mouse, keyboard and clipboard while it watches. */
  control: boolean
  online: boolean
}

/** What the feedback dialog sends; main adds the technical details itself when `includeInfo` is set. */
export interface FeedbackDraft {
  kind: 'bug' | 'idea'
  message: string
  email: string
  /** Base64 JPEG from `feedback.capture()`, or null to send none. */
  screenshot: string | null
  includeInfo: boolean
}

/** What the remote desktop window learns about the other computer when it opens. */
export interface RemoteDesktopInit {
  name: string
  /** This aFinder's language and platform. */
  language: string
  platform: string
  info: HostInfo
  displays: ScreenDisplay[]
}

/** The phone companion, for the settings dialog. */
export interface CompanionStatus {
  enabled: boolean
  /** Which kinds of devices may connect; the relay connection runs while either may. */
  kinds: Record<DeviceKind, boolean>
  state: 'off' | 'connecting' | 'online' | 'offline'
  error: string | null
  relay: string
  devices: CompanionDevice[]
  /** The QR code (phone) or link (computer) being shown for pairing a new device of `kind`. */
  pairing: { kind: DeviceKind; uri: string; qr: string; expiresAt: number } | null
  /** A device used the code and waits for the user to compare the code and confirm. */
  request: { kind: DeviceKind; name: string; sas: string } | null
  /** Devices may be allowed to control this computer (not in the Mac App Store build). */
  controlSupported: boolean
  /** A device is watching (and with `control` also controlling) the screen right now. */
  screen: { device: string; since: number; control: boolean } | null
}

/** What the focused tab shows – reported by the renderer for the MCP get_current_view tool. */
export interface McpView {
  folder: string
  selection: string[]
}

/** Bitcoin in USD for the Bitcoin theme's title bar. */
export interface BtcQuote {
  price: number
  /** Change over the last seven days in percent (−3.2 = down 3.2 %); null when CoinGecko leaves it out. */
  change7d: number | null
}

/** Machine stats for the theme field of the status bar; null where unavailable. */
export interface SystemInfo {
  /** Share of CPU time busy since the previous call, 0–1. */
  cpu: number | null
  memUsed: number
  memTotal: number
  /** Seconds since boot. */
  uptime: number
  user: string
  host: string
  /** Disk holding the requested folder; null for archives, remote mounts and errors. */
  diskFree: number | null
  diskTotal: number | null
}
