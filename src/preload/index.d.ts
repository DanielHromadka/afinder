import type { AfinderApi } from '@shared/types'

declare global {
  interface Window {
    api: AfinderApi
  }
}
