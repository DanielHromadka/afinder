// To-dos of the Todo area and the notes pinned to files, kept in <userData>/todos.json and notes.json and
// shown in every window. Both share one change event, since the file list shows them together.

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { sanitizeNote, sanitizeNotes, sanitizeTodo, sanitizeTodos, sortTodos, upsertTodo, type Note, type Todo } from '@shared/todos'
import { IPC } from '@shared/types'

let list: Todo[] | null = null
let notes: Note[] | null = null
let saving: ReturnType<typeof setTimeout> | null = null

const file = (name: string): string => path.join(app.getPath('userData'), name)

function read<T>(name: string, sanitize: (value: unknown) => T[]): T[] {
  try {
    return sanitize(JSON.parse(readFileSync(file(name), 'utf8')))
  } catch {
    return []
  }
}

const load = (): Todo[] => (list ??= read('todos.json', sanitizeTodos))
const loadNotes = (): Note[] => (notes ??= read('notes.json', sanitizeNotes))

/** Writes soon (typing ticks off several items in a row) and tells every window. */
function changed(): void {
  if (!saving) {
    saving = setTimeout(() => {
      saving = null
      const write = (name: string, value: unknown[] | null): void => {
        if (value) writeFile(file(name), JSON.stringify(value, null, 1)).catch((err) => console.error(`Cannot save ${name}`, err))
      }
      write('todos.json', list)
      write('notes.json', notes)
    }, 300)
  }
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send(IPC.todosChanged)
}

export const todos = (): Todo[] => sortTodos(load())

export function save(value: unknown): void {
  const todo = sanitizeTodo(value)
  if (!todo) throw new Error('Invalid to-do')
  list = upsertTodo(load(), todo)
  changed()
}

export function remove(id: unknown): void {
  list = load().filter((x) => x.id !== id)
  changed()
}

export function clearDone(): void {
  list = load().filter((x) => !x.done)
  changed()
}

export const allNotes = (): Note[] => loadNotes()

/** Sets the note of `path`; an empty text removes it. */
export function saveNote(p: unknown, text: unknown): void {
  if (typeof p !== 'string' || typeof text !== 'string') throw new Error('Invalid note')
  const note = sanitizeNote({ path: p, text, updatedAt: Date.now() })
  const rest = loadNotes().filter((x) => x.path !== p)
  notes = sanitizeNotes(note ? [note, ...rest] : rest)
  changed()
}
