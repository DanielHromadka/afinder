import { useColorScheme } from 'react-native'

// The palette of aFinder's clean macOS look: one light background, white cards, blue accent.
const light = { bg: '#f7f8fa', card: '#ffffff', text: '#1d1d1f', muted: '#6e6e73', line: '#e5e5ea', accent: '#0a84ff', danger: '#ff3b30', ok: '#34c759', folder: '#4aa3f0' }
const dark: typeof light = { bg: '#000000', card: '#1c1c1e', text: '#f5f5f7', muted: '#98989d', line: '#38383a', accent: '#0a84ff', danger: '#ff453a', ok: '#30d158', folder: '#5ab0f5' }
export type Colors = typeof light

export const useColors = (): Colors => (useColorScheme() === 'dark' ? dark : light)
