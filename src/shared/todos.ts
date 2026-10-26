// To-dos of the Todo area: one list for the whole app, each item optionally tied to a file or folder.
// Shared so that main keeps the list and the renderer edits it with the same types and limits.

export interface Todo {
  id: string
  text: string
  done: boolean
  /** File or folder the to-do is about; clicking it opens it in a tab. */
  path?: string
  isDir?: boolean
  createdAt: number
  /** When it was ticked off; done items sort by it. */
  doneAt?: number
}

export const MAX_TODOS = 500
export const MAX_TODO_TEXT = 1000

const validPath = (p: unknown): p is string => typeof p === 'string' && p.length > 0 && p.length <= 4096 && !p.includes('\0')

/** One well-formed to-do or null – both the file on disk and IPC input may be anything. */
export function sanitizeTodo(value: unknown): Todo | null {
  if (typeof value !== 'object' || value === null) return null
  const { id, text, done, path, isDir, createdAt, doneAt } = value as Record<string, unknown>
  if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id) || typeof text !== 'string') return null
  const clean = text.trim().slice(0, MAX_TODO_TEXT)
  if (!clean || typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null
  const todo: Todo = { id, text: clean, done: done === true, createdAt }
  if (validPath(path)) Object.assign(todo, { path, isDir: isDir === true })
  if (todo.done) todo.doneAt = typeof doneAt === 'number' && Number.isFinite(doneAt) ? doneAt : createdAt
  return todo
}

/** Open items first in the order they were added, then done ones, latest ticked off first. */
export function sortTodos(list: Todo[]): Todo[] {
  return [...list].sort((a, b) => (a.done !== b.done ? (a.done ? 1 : -1) : a.done ? (b.doneAt ?? 0) - (a.doneAt ?? 0) : a.createdAt - b.createdAt))
}

export function sanitizeTodos(value: unknown): Todo[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: Todo[] = []
  for (const v of value) {
    const todo = sanitizeTodo(v)
    if (!todo || seen.has(todo.id)) continue
    seen.add(todo.id)
    out.push(todo)
  }
  return sortTodos(out).slice(0, MAX_TODOS)
}

/** Replaces the item with the same id or adds it; a full list drops the oldest done items first. */
export function upsertTodo(list: Todo[], todo: Todo): Todo[] {
  const next = sortTodos(list.some((x) => x.id === todo.id) ? list.map((x) => (x.id === todo.id ? todo : x)) : [...list, todo])
  return next.length > MAX_TODOS ? next.filter((x) => !x.done || x === todo).slice(0, MAX_TODOS) : next
}

/** The item is about `folder`: the folder itself or something directly inside it. */
export function todoInFolder(todo: Todo, folder: string, same: (a: string, b: string) => boolean, dirOf: (p: string) => string): boolean {
  return !!todo.path && (same(todo.path, folder) || same(dirOf(todo.path), folder))
}

/** A free note pinned to a file or folder: one per path, kept next to the to-dos. */
export interface Note {
  path: string
  text: string
  updatedAt: number
}

export const MAX_NOTES = 2000
export const MAX_NOTE_TEXT = 20000

/** One well-formed note or null; an empty text is no note. Line breaks are kept, only the ends are trimmed. */
export function sanitizeNote(value: unknown): Note | null {
  if (typeof value !== 'object' || value === null) return null
  const { path, text, updatedAt } = value as Record<string, unknown>
  if (!validPath(path) || typeof text !== 'string') return null
  const clean = text.trim().slice(0, MAX_NOTE_TEXT)
  if (!clean) return null
  return { path, text: clean, updatedAt: typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : 0 }
}

/** Valid notes, one per path (the latest wins), newest first. */
export function sanitizeNotes(value: unknown): Note[] {
  if (!Array.isArray(value)) return []
  const byPath = new Map<string, Note>()
  for (const v of value) {
    const note = sanitizeNote(v)
    const prev = note && byPath.get(note.path)
    if (note && (!prev || prev.updatedAt <= note.updatedAt)) byPath.set(note.path, note)
  }
  return [...byPath.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_NOTES)
}
