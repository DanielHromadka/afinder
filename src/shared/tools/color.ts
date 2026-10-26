// Colour notations for the Colours tool: #rgb/#rrggbb, rgb(), hsl(), all to and from RGB.

export interface Rgb {
  r: number
  g: number
  b: number
}

export function parseColor(text: string): Rgb | null {
  const s = text.trim().toLowerCase()
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1]
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
  }
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(s)
  if (rgb) {
    const [r, g, b] = rgb.slice(1, 4).map(Number)
    return r <= 255 && g <= 255 && b <= 255 ? { r, g, b } : null
  }
  const hsl = /^hsla?\(\s*(\d+(?:\.\d+)?)(?:deg)?[\s,]+(\d+(?:\.\d+)?)%[\s,]+(\d+(?:\.\d+)?)%/.exec(s)
  if (hsl) return hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]))
  return null
}

export const toHex = ({ r, g, b }: Rgb): string => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
export const toRgbText = ({ r, g, b }: Rgb): string => `rgb(${r}, ${g}, ${b})`

export function toHsl({ r, g, b }: Rgb): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return [0, 0, Math.round(l * 100)]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)]
}
export const toHslText = (c: Rgb): string => {
  const [h, s, l] = toHsl(c)
  return `hsl(${h}, ${s}%, ${l}%)`
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const S = s / 100
  const L = l / 100
  const k = (n: number): number => (n + h / 30) % 12
  const a = S * Math.min(L, 1 - L)
  const f = (n: number): number => Math.round((L - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * 255)
  return { r: f(0), g: f(8), b: f(4) }
}

/** Black or white, whichever reads better on the colour. */
export const contrastText = ({ r, g, b }: Rgb): string => (0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000' : '#fff')
