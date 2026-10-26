import { describe, expect, it } from 'vitest'
import { MAX_TODOS, sanitizeNote, sanitizeNotes, sanitizeTodo, sanitizeTodos, sortTodos, upsertTodo, type Todo } from './todos'

const item = (id: string, extra: Partial<Todo> = {}): Todo => ({ id, text: id, done: false, createdAt: 1, ...extra })

describe('todos', () => {
  it('drops malformed items and trims text', () => {
    expect(sanitizeTodo({ id: 'a', text: '  x  ', createdAt: 1 })).toEqual({ id: 'a', text: 'x', done: false, createdAt: 1 })
    expect(sanitizeTodo({ id: 'a', text: '   ', createdAt: 1 })).toBeNull()
    expect(sanitizeTodo({ id: '../x', text: 'x', createdAt: 1 })).toBeNull()
    expect(sanitizeTodo({ id: 'a', text: 'x', createdAt: 1, path: 'a\0b' })).toEqual(item('a', { text: 'x' }))
    expect(sanitizeTodos([item('a'), item('a'), null, 'x'])).toHaveLength(1)
  })

  it('lists open items by creation, then done items latest first', () => {
    const list = [item('d1', { done: true, doneAt: 5 }), item('o2', { createdAt: 2 }), item('d2', { done: true, doneAt: 9 }), item('o1')]
    expect(sortTodos(list).map((x) => x.id)).toEqual(['o1', 'o2', 'd2', 'd1'])
  })

  it('replaces by id and makes room by dropping done items', () => {
    expect(upsertTodo([item('a')], item('a', { text: 'new' }))).toEqual([item('a', { text: 'new' })])
    const full = [...Array.from({ length: MAX_TODOS - 1 }, (_, i) => item(`o${i}`)), item('d', { done: true, doneAt: 2 })]
    const next = upsertTodo(full, item('new', { createdAt: 3 }))
    expect(next).toHaveLength(MAX_TODOS)
    expect(next.some((x) => x.id === 'd')).toBe(false)
  })

  it('keeps one trimmed note per path, the latest one', () => {
    expect(sanitizeNote({ path: '/a', text: '  line 1\nline 2 ', updatedAt: 1 })).toEqual({ path: '/a', text: 'line 1\nline 2', updatedAt: 1 })
    expect(sanitizeNote({ path: '/a', text: '  ' })).toBeNull()
    expect(sanitizeNote({ path: 'a\0b', text: 'x' })).toBeNull()
    const notes = sanitizeNotes([{ path: '/a', text: 'old', updatedAt: 1 }, { path: '/b', text: 'b', updatedAt: 2 }, { path: '/a', text: 'new', updatedAt: 3 }, 'x'])
    expect(notes.map((n) => n.text)).toEqual(['new', 'b'])
  })
})
