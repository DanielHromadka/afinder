// AI actions on files that need an answer back in the app (not a conversation in the console):
// rename suggestions and automation proposals from Claude Code in print mode. The command line is
// constant; the request goes through stdin. Claude runs without tools or access to the user's files.

import { spawn } from 'node:child_process'
import os from 'node:os'
import { t } from '@shared/i18n'
import { sessionEnv, shellArgs, userShell } from './terminals'

const MAX_ITEMS = 300
const TIMEOUT_MS = 180_000
const CLAUDE = 'claude -p --tools "" --output-format json --no-session-persistence'

export interface NameItem {
  name: string
  isDir: boolean
}

function sanitizeItems(input: unknown): NameItem[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ITEMS) throw new Error(t('error.invalidList'))
  return input.map((i) => {
    const item = (i ?? {}) as Record<string, unknown>
    if (typeof item.name !== 'string' || item.name.length === 0 || item.name.length > 1024) throw new Error(t('error.invalidList'))
    return { name: item.name, isDir: item.isDir === true }
  })
}

export function renamePrompt(items: NameItem[], hint: string, language: string): string {
  return [
    'You help rename files in a file manager. Suggest a clearer, consistent name for each item below.',
    '- Keep every file extension exactly as it is. Folders have no extension.',
    `- Write the names in the language of the original names; if unclear, use language "${language}".`,
    '- Do not use the characters / \\ : * ? " < > | and do not end a name with a dot or a space.',
    '- Keep names short; keep meaningful numbers and dates (prefer ISO dates like 2026-10-08).',
    '- Every name must be unique. Return the same number of names in the same order.',
    hint ? `- The user asks: ${hint}` : '',
    'Reply with only a JSON array of strings – no explanation, no code fence.',
    '',
    'Items (JSON):',
    JSON.stringify(items.map((i) => (i.isDir ? { name: i.name, folder: true } : { name: i.name })))
  ]
    .filter((l) => l !== '')
    .join('\n')
}

/** The JSON array in Claude's answer, checked to have one string per item. */
export function parseSuggestions(stdout: string, count: number): string[] {
  // Shell start-up files may print before Claude's single JSON line: take the last line that parses.
  let result: { result?: unknown; is_error?: boolean } | null = null
  for (const line of stdout.split(/\r?\n/).reverse()) {
    if (!line.trim().startsWith('{')) continue
    try {
      result = JSON.parse(line)
      break
    } catch {
      // not the JSON line
    }
  }
  if (!result || typeof result.result !== 'string') throw new Error(t('ai.error.noAnswer'))
  if (result.is_error) throw new Error(result.result)
  const text = result.result
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error(t('ai.error.badAnswer'))
  let names: unknown
  try {
    names = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error(t('ai.error.badAnswer'))
  }
  if (!Array.isArray(names) || names.length !== count || names.some((n) => typeof n !== 'string')) throw new Error(t('ai.error.badAnswer'))
  return (names as string[]).map((n) => n.trim())
}

export function runClaude(input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child =
      process.platform === 'win32'
        ? spawn(CLAUDE, { shell: true, cwd: os.homedir(), env: sessionEnv(), windowsHide: true })
        : spawn(userShell(), [...shellArgs(userShell()), '-c', CLAUDE], { cwd: os.homedir(), env: sessionEnv() })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(t('ai.error.timeout')))
    }, TIMEOUT_MS)
    child.stdout.on('data', (d) => {
      out += d
      if (out.length > 1_000_000) { child.kill(); clearTimeout(timer); reject(new Error(t('ai.error.badAnswer'))) }
    })
    child.stderr.on('data', (d) => { err = (err + d).slice(-16000) })
    child.stdin.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (out.trim()) resolve(out)
      else reject(new Error(code === 127 ? t('ai.error.notInstalled') : err.trim().split('\n').slice(-3).join('\n') || t('ai.error.noAnswer')))
    })
    child.stdin.end(input)
  })
}

export async function suggestNames(itemsInput: unknown, hintInput: unknown, languageInput: unknown): Promise<string[]> {
  const items = sanitizeItems(itemsInput)
  const hint = typeof hintInput === 'string' ? hintInput.replace(/\s+/g, ' ').trim().slice(0, 500) : ''
  const language = typeof languageInput === 'string' && /^[a-z]{2}$/.test(languageInput) ? languageInput : 'en'
  return parseSuggestions(await runClaude(renamePrompt(items, hint, language)), items.length)
}
