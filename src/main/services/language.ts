import { app } from 'electron'
import { resolveLanguage, setLanguage, setOs } from '@shared/i18n'
import { loadState } from './settings'

/** Sets the main process language (error messages, place names, "New Folder") from the settings. */
export function applyLanguage(): void {
  setOs(process.platform)
  setLanguage(resolveLanguage(loadState().language, app.getPreferredSystemLanguages()))
}
