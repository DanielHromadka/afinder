// The computer name people know ("Daniel's MacBook Pro", not "Daniels-MacBook-Pro.local"): shown to paired
// phones and computers (companion.ts) and sent when this aFinder pairs with another one (remote/afinder.ts).

import { execFile } from 'node:child_process'
import os from 'node:os'

// AFINDER_COMPUTER_NAME names a demo computer (store screenshots) instead of this Mac.
let friendlyName: string | null = process.env.AFINDER_COMPUTER_NAME || null
export const computerName = (): string => friendlyName ?? os.hostname().replace(/\.local$/, '')
if (process.platform === 'darwin' && !friendlyName) {
  execFile('scutil', ['--get', 'ComputerName'], { timeout: 2000 }, (err, out) => {
    if (!err && out.trim()) friendlyName = out.trim().slice(0, 64)
  })
}
