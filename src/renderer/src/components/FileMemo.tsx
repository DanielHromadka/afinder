// To-dos and the note pinned to a file, shown as a badge in the file list and opened in a popover.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '@shared/i18n'
import { baseName, pathKey } from '@shared/paths'
import { MAX_NOTE_TEXT, MAX_TODO_TEXT, sortTodos, type Note, type Todo } from '@shared/todos'
import { Icon } from './Icon'
import { newTodoId, TodoItem } from './TodoItem'

const api = window.api

/** What the file list knows about one path. */
export interface FileMemo {
  todos: Todo[]
  open: number
  note: Note | null
}

/** Every to-do and note, kept in sync with main (all windows share them). */
export function useFileMemos(showError: (err: unknown) => void): Map<string, FileMemo> {
  const [todos, setTodos] = useState<Todo[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  useEffect(() => {
    const load = (): void => {
      api.todos.list().then(setTodos, showError)
      api.todos.notes().then(setNotes, showError)
    }
    load()
    return api.todos.onChanged(load)
  }, [showError])
  return useMemo(() => {
    const map = new Map<string, FileMemo>()
    const at = (p: string): FileMemo => {
      const key = pathKey(p)
      let memo = map.get(key)
      if (!memo) map.set(key, (memo = { todos: [], open: 0, note: null }))
      return memo
    }
    for (const todo of todos) {
      if (!todo.path) continue
      const memo = at(todo.path)
      memo.todos.push(todo)
      if (!todo.done) memo.open++
    }
    for (const note of notes) at(note.path).note = note
    return map
  }, [todos, notes])
}

export const memoOf = (memos: Map<string, FileMemo>, path: string): FileMemo | undefined => memos.get(pathKey(path))

/** The badge after a file name: open to-dos and whether there is a note. Clicking it must not select the row. */
export function MemoBadge({ memo, onOpen }: { memo: FileMemo; onOpen(anchor: DOMRect): void }): React.JSX.Element {
  const title = [memo.todos.length ? t('memo.todos', { open: memo.open, all: memo.todos.length }) : '', memo.note ? t('memo.hasNote') : '']
    .filter(Boolean)
    .join(' · ')
  return (
    <button
      className={`memo-badge${memo.todos.length && !memo.open ? ' all-done' : ''}`}
      title={title}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => (e.stopPropagation(), onOpen(e.currentTarget.getBoundingClientRect()))}
    >
      {memo.todos.length > 0 && (
        <>
          <Icon name="todo" size={12} />
          {memo.open > 0 && <span>{memo.open}</span>}
        </>
      )}
      {memo.note && <Icon name="note" size={12} />}
    </button>
  )
}

interface PopoverProps {
  path: string
  isDir: boolean
  memo: FileMemo | undefined
  anchor: { x: number; y: number }
  /** Start in the note (from the context menu) rather than in the new to-do field. */
  focusNote: boolean
  showError(err: unknown): void
  onClose(): void
}

/** The to-dos and the note of one file, editable in place; Esc or a click outside closes it. */
export function MemoPopover(p: PopoverProps): React.JSX.Element {
  const { showError } = p
  const ref = useRef<HTMLDivElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [pos, setPos] = useState({ x: p.anchor.x, y: p.anchor.y })
  const todos = sortTodos(p.memo?.todos ?? [])
  const savedNote = p.memo?.note?.text ?? ''

  // Keep it on screen: flip above the anchor or shift left when it would overflow.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const x = Math.max(4, Math.min(p.anchor.x, window.innerWidth - box.width - 4))
    const y = p.anchor.y + box.height > window.innerHeight - 4 ? Math.max(4, p.anchor.y - box.height - 22) : p.anchor.y
    setPos({ x, y })
  }, [p.anchor.x, p.anchor.y])

  useEffect(() => {
    if (p.focusNote) noteRef.current?.focus()
  }, [p.focusNote])

  const save = (todo: Todo): void => void api.todos.save(todo).catch(showError)
  const add = (): void => {
    const clean = text.trim()
    if (!clean) return
    save({ id: newTodoId(), text: clean, done: false, createdAt: Date.now(), path: p.path, isDir: p.isDir })
    setText('')
  }
  const saveNote = (value: string): void => {
    if (value.trim() !== savedNote) api.todos.saveNote(p.path, value).catch(showError)
  }
  /** Closing unmounts the textarea before it would blur, so the note is saved here. */
  const close = (): void => {
    if (noteRef.current) saveNote(noteRef.current.value)
    p.onClose()
  }
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    const away = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current()
    }
    document.addEventListener('mousedown', away, true)
    return () => document.removeEventListener('mousedown', away, true)
  }, [])

  return createPortal(
    <div
      ref={ref}
      className="memo-popover"
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={(e) => {
        // Keys typed here belong to the popover, not to the file list behind it.
        e.stopPropagation()
        if (e.key === 'Escape') close()
      }}
    >
      <div className="memo-head">
        <Icon name={p.isDir ? 'folder' : 'document'} size={16} />
        <span className="memo-title" title={p.path}>
          {baseName(p.path)}
        </span>
        <button className="todo-del memo-close" title={t('memo.close')} onClick={close}>
          ×
        </button>
      </div>
      <div className="memo-section">{t('memo.todosTitle')}</div>
      <div className="memo-todos">
        {todos.map((todo) => (
          <TodoItem
            key={todo.id}
            todo={todo}
            editing={editing === todo.id}
            onEditing={(on) => setEditing(on ? todo.id : null)}
            onSave={save}
            onRemove={() => void api.todos.remove(todo.id).catch(showError)}
          />
        ))}
        <form
          className="todo-add"
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <input value={text} autoFocus={!p.focusNote} maxLength={MAX_TODO_TEXT} placeholder={t('todo.placeholder')} onChange={(e) => setText(e.target.value)} />
        </form>
      </div>
      <div className="memo-section">
        {t('memo.noteTitle')}
        <span className="memo-hint">{t('memo.noteHint')}</span>
      </div>
      <textarea
        ref={noteRef}
        key={savedNote}
        className="memo-note"
        defaultValue={savedNote}
        maxLength={MAX_NOTE_TEXT}
        placeholder={t('memo.notePlaceholder')}
        onBlur={(e) => saveNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.preventDefault(), close()
        }}
      />
      {savedNote && (
        <div className="memo-actions">
          <button className="todo-btn" onClick={() => void api.todos.saveNote(p.path, '').catch(showError)}>
            {t('memo.deleteNote')}
          </button>
        </div>
      )}
    </div>,
    document.body
  )
}
