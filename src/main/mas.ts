// The Mac App Store build runs in the App Sandbox. Imported first in index.ts: everything after it sees the
// user's real home, while Electron keeps its own data (userData) in the app's container.
import os from 'node:os'

export const isMas = process.mas === true

// Inside the sandbox $HOME is the container (~/Library/Containers/<id>/Data), so os.homedir(), `~`, the
// home place, terminals, git and agents would all look there. The account still knows the real home.
if (isMas) process.env.HOME = os.userInfo().homedir
