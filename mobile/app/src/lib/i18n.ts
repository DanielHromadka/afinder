// The app uses aFinder's own dictionaries (src/shared/i18n): one set of translations for both.
import { getLocales } from 'expo-localization'
import { resolveLanguage, setLanguage } from '../../../../src/shared/i18n'

export { t, plural, locale } from '../../../../src/shared/i18n'

export function initLanguage(): void {
  setLanguage(resolveLanguage('auto', getLocales().map((l) => l.languageTag)))
}
