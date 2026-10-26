// Unit conversion: every unit is a factor to its category's base unit, except temperatures, which
// convert through kelvin. Symbols are international, so only category names need translating.

export const UNIT_CATEGORIES = ['length', 'mass', 'temperature', 'area', 'volume', 'speed', 'data', 'time'] as const
export type UnitCategory = (typeof UNIT_CATEGORIES)[number]

/** Symbol → factor to the base unit (m, kg, K, m², l, m/s, B, s). */
export const UNITS: Record<UnitCategory, Record<string, number>> = {
  length: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, nmi: 1852 },
  mass: { mg: 1e-6, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237, st: 6.35029318 },
  temperature: { '°C': 1, '°F': 1, K: 1 },
  area: { 'mm²': 1e-6, 'cm²': 1e-4, 'm²': 1, a: 100, ha: 10_000, 'km²': 1e6, 'ft²': 0.09290304, ac: 4046.8564224, 'mi²': 2_589_988.110336 },
  volume: { ml: 0.001, cl: 0.01, dl: 0.1, l: 1, 'm³': 1000, tsp: 0.00492892159375, tbsp: 0.01478676478125, 'fl oz': 0.0295735295625, cup: 0.2365882365, pt: 0.473176473, gal: 3.785411784 },
  speed: { 'm/s': 1, 'km/h': 1 / 3.6, mph: 0.44704, kn: 1852 / 3600, 'ft/s': 0.3048 },
  data: { b: 0.125, B: 1, kB: 1000, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 },
  time: { ms: 0.001, s: 1, min: 60, h: 3600, d: 86_400, wk: 604_800, mo: 2_629_746, yr: 31_556_952 }
}

const toKelvin = (v: number, u: string): number => (u === '°C' ? v + 273.15 : u === '°F' ? ((v - 32) * 5) / 9 + 273.15 : v)
const fromKelvin = (k: number, u: string): number => (u === '°C' ? k - 273.15 : u === '°F' ? ((k - 273.15) * 9) / 5 + 32 : k)

export function convertUnit(value: number, category: UnitCategory, from: string, to: string): number {
  if (category === 'temperature') return fromKelvin(toKelvin(value, from), to)
  const units = UNITS[category]
  if (!(from in units) || !(to in units)) throw new Error('unknown unit')
  return (value * units[from]) / units[to]
}
