// Which folder listing may still be shown when its answer arrives. Answers come back in any order (a slow
// network share, a remote connection), so the last navigation wins: an older navigation or a refresh
// started before it is dropped. A refresh never cancels a navigation that is still on its way.

export interface LoadGate {
  /** Starts a navigation; the returned check says whether its answer is still wanted. */
  navigation(): () => boolean
  /** Starts a refresh of the current folder; wanted only while no navigation or newer refresh came after it. */
  refresh(): () => boolean
}

export function createLoadGate(): LoadGate {
  let navigations = 0
  let refreshes = 0
  return {
    navigation() {
      const mine = ++navigations
      return () => mine === navigations
    },
    refresh() {
      const nav = navigations
      const mine = ++refreshes
      return () => nav === navigations && mine === refreshes
    }
  }
}
