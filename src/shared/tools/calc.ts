// The calculator's expression language: numbers (1.5 or 1,5), + − × ÷ ^ %, factorial, parentheses,
// functions and constants. A small recursive-descent parser instead of eval: the renderer's CSP
// forbids eval anyway, and a typed expression must never run as code.

export type AngleUnit = 'deg' | 'rad'

export class CalcError extends Error {}

const FUNCTIONS: Record<string, (x: number, angle: AngleUnit) => number> = {
  sin: (x, a) => Math.sin(toRad(x, a)),
  cos: (x, a) => Math.cos(toRad(x, a)),
  tan: (x, a) => Math.tan(toRad(x, a)),
  asin: (x, a) => fromRad(Math.asin(x), a),
  acos: (x, a) => fromRad(Math.acos(x), a),
  atan: (x, a) => fromRad(Math.atan(x), a),
  sqrt: (x) => Math.sqrt(x),
  cbrt: (x) => Math.cbrt(x),
  ln: (x) => Math.log(x),
  log: (x) => Math.log10(x),
  log2: (x) => Math.log2(x),
  exp: (x) => Math.exp(x),
  abs: (x) => Math.abs(x),
  round: (x) => Math.round(x),
  floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x)
}
export const CALC_FUNCTIONS = Object.keys(FUNCTIONS)

const toRad = (x: number, a: AngleUnit): number => (a === 'deg' ? (x * Math.PI) / 180 : x)
const fromRad = (x: number, a: AngleUnit): number => (a === 'deg' ? (x * 180) / Math.PI : x)

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new CalcError('factorial')
  if (n > 170) return Infinity
  let r = 1
  for (let i = 2; i <= n; i++) r *= i
  return r
}

type Token = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string }

function tokenize(src: string): Token[] {
  const s = src.replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/π/g, 'pi').replace(/√/g, 'sqrt ')
  const out: Token[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    const num = /^(\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?/i.exec(s.slice(i))
    if (num) {
      out.push({ t: 'num', v: parseFloat(num[0].replace(',', '.')) })
      i += num[0].length
      continue
    }
    // Letters only (log2 aside), so √16 and 2pi split into a name and a number.
    const id = /^(log2|[a-z]+)/i.exec(s.slice(i))
    if (id) {
      out.push({ t: 'id', v: id[0].toLowerCase() })
      i += id[0].length
      continue
    }
    if ('+-*/^%!()'.includes(c)) {
      out.push({ t: 'op', v: c })
      i++
      continue
    }
    throw new CalcError(`unexpected ${c}`)
  }
  return out
}

/**
 * Evaluates `expr`. Precedence: unary minus < ^ (right-assoc.) < postfix ! and %, so −2^2 = −4 and
 * 50% = 0.5; "200 + 10%" adds ten percent of 200 like a pocket calculator.
 */
export function evaluate(expr: string, opts: { angle?: AngleUnit; ans?: number } = {}): number {
  const angle = opts.angle ?? 'deg'
  const tokens = tokenize(expr)
  if (!tokens.length) throw new CalcError('empty')
  let pos = 0
  const peek = (): Token | undefined => tokens[pos]
  const isOp = (v: string): boolean => peek()?.t === 'op' && peek()!.v === v

  // A trailing percent after + or − means "percent of the left side".
  const additive = (): number => {
    let left = multiplicative()
    while (isOp('+') || isOp('-')) {
      const op = tokens[pos++].v
      const start = pos
      let right = multiplicative()
      const last = tokens[pos - 1]
      if (last?.t === 'op' && last.v === '%' && pos - start >= 2) right = left * right
      left = op === '+' ? left + right : left - right
    }
    return left
  }
  const multiplicative = (): number => {
    let left = unary()
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = tokens[pos++].v
        const right = unary()
        left = op === '*' ? left * right : left / right
      } else if (peek() && (peek()!.t === 'num' || peek()!.t === 'id' || isOp('('))) {
        left *= unary() // implicit multiplication: 2pi, 3(4+1)
      } else return left
    }
  }
  const unary = (): number => {
    if (isOp('-')) {
      pos++
      return -unary()
    }
    if (isOp('+')) {
      pos++
      return unary()
    }
    return power()
  }
  const power = (): number => {
    const base = postfix()
    if (isOp('^')) {
      pos++
      return Math.pow(base, unary())
    }
    return base
  }
  const postfix = (): number => {
    let v = primary()
    for (;;) {
      if (isOp('!')) {
        pos++
        v = factorial(v)
      } else if (isOp('%')) {
        pos++
        v = v / 100
      } else return v
    }
  }
  const primary = (): number => {
    const tok = tokens[pos++]
    if (!tok) throw new CalcError('incomplete')
    if (tok.t === 'num') return tok.v
    if (tok.t === 'op' && tok.v === '(') {
      const v = additive()
      if (!isOp(')')) throw new CalcError('missing )')
      pos++
      return v
    }
    if (tok.t === 'id') {
      if (tok.v === 'pi') return Math.PI
      if (tok.v === 'e') return Math.E
      if (tok.v === 'ans') return opts.ans ?? 0
      const fn = FUNCTIONS[tok.v]
      if (!fn) throw new CalcError(`unknown ${tok.v}`)
      // sin 30 or sin(30)
      return fn(isOp('(') ? primary() : postfix(), angle)
    }
    throw new CalcError(`unexpected ${tok.v}`)
  }

  const value = additive()
  if (pos < tokens.length) throw new CalcError(`unexpected ${tokens[pos].v}`)
  if (Number.isNaN(value)) throw new CalcError('nan')
  return value
}

/** Up to 12 significant digits, trailing zeros trimmed; the locale's decimal separator. */
export function formatNumber(n: number, locale = 'en'): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : n < 0 ? '−∞' : '?'
  const abs = Math.abs(n)
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) return n.toExponential(8).replace(/\.?0+e/, 'e')
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 12, useGrouping: true }).format(n)
}
