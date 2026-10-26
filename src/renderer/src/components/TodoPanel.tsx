import { useEffect, useRef, useState } from 'react'
import { plural, t } from '@shared/i18n'
import { baseName, dirOf, samePath } from '@shared/paths'
import { MAX_TODO_TEXT, todoInFolder, type Todo } from '@shared/todos'
import type { MenuState } from './ContextMenu'
import { Icon } from './Icon'
import { newTodoId, toggled, TodoItem } from './TodoItem'

const api = window.api

/** A file or folder a new to-do will be about. */
export interface TodoLink {
  path: string
  isDir: boolean
}

interface Props {
  /** Folder of the focused tab, for the "This folder" filter and attaching it. */
  cwd: string
  /** "Add to-do…" from a file's menu: focuses the input with that link attached; `nonce` repeats it. */
  draft: (TodoLink & { nonce: number }) | null
  showError(err: unknown): void
  showMenu(menu: MenuState): void
  onOpenLink(link: TodoLink): void
}

/** The Todo area: one list for the whole app, items optionally tied to a file or folder. */
export function TodoPanel(p: Props): React.JSX.Element {
  const [todos, setTodos] = useState<Todo[]>([])
  const [text, setText] = useState('')
  const [link, setLink] = useState<TodoLink | null>(null)
  const [here, setHere] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const { showError } = p

  useEffect(() => {
    const load = (): void => void api.todos.list().then(setTodos, showError)
    load()
    return api.todos.onChanged(load)
  }, [showError])

  useEffect(() => {
    if (!p.draft) return
    setLink({ path: p.draft.path, isDir: p.draft.isDir })
    // The area host is moved into place in a layout effect; focus once it is there.
    requestAnimationFrame(() => input.current?.focus())
  }, [p.draft])

  /** Saves optimistically; the broadcast from main brings the authoritative list. */
  const save = (todo: Todo): void => {
    setTodos((list) => (list.some((x) => x.id === todo.id) ? list.map((x) => (x.id === todo.id ? todo : x)) : [...list, todo]))
    api.todos.save(todo).catch(showError)
  }
  const remove = (id: string): void => {
    setTodos((list) => list.filter((x) => x.id !== id))
    api.todos.remove(id).catch(showError)
  }
  const toggle = (todo: Todo): void => save(toggled(todo))

  const add = (): void => {
    const clean = text.trim()
    if (!clean) return
    save({ id: newTodoId(), text: clean, done: false, createdAt: Date.now(), ...(link ?? {}) })
    setText('')
    setLink(null)
  }

  const linkOf = (todo: Todo): TodoLink | null => (todo.path ? { path: todo.path, isDir: todo.isDir === true } : null)

  const showItemMenu = (todo: Todo, e: React.MouseEvent): void => {
    e.preventDefault()
    const l = linkOf(todo)
    p.showMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t(todo.done ? 'todo.markOpen' : 'todo.markDone'), onClick: () => toggle(todo) },
        { label: t('todo.edit'), icon: 'rename', onClick: () => setEditing(todo.id) },
        ...(l
          ? [
              { label: t('todo.openLink', { name: baseName(l.path) }), icon: 'open' as const, onClick: () => p.onOpenLink(l) },
              { label: t('todo.unlink'), onClick: () => save({ ...todo, path: undefined, isDir: undefined }) }
            ]
          : [{ label: t('todo.attach'), onClick: () => save({ ...todo, path: p.cwd, isDir: true }) }]),
        'separator',
        { label: t('todo.delete'), icon: 'trash', onClick: () => remove(todo.id) }
      ]
    })
  }

  const shown = here ? todos.filter((x) => todoInFolder(x, p.cwd, samePath, dirOf)) : todos
  const open = todos.filter((x) => !x.done).length
  const anyDone = todos.some((x) => x.done)

  return (
    <div className="todo-panel">
      <form
        className="todo-add"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input
          ref={input}
          value={text}
          maxLength={MAX_TODO_TEXT}
          placeholder={t('todo.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (setText(''), setLink(null))}
        />
        <button type="submit" className="todo-btn" disabled={!text.trim()}>
          {t('todo.add')}
        </button>
        {link && (
          <span className="todo-chip" title={t('todo.linkTitle', { path: link.path })}>
            <Icon name={link.isDir ? 'folder' : 'document'} size={14} />
            <span className="todo-chip-name">{baseName(link.path)}</span>
            <button type="button" className="todo-chip-x" title={t('todo.unlink')} onClick={() => setLink(null)}>
              ×
            </button>
          </span>
        )}
      </form>
      <div className="todo-bar">
        <div className="todo-seg">
          <button className={here ? '' : 'on'} onClick={() => setHere(false)}>
            {t('todo.all')}
          </button>
          <button className={here ? 'on' : ''} title={t('todo.hereTitle')} onClick={() => setHere(true)}>
            {t('todo.here')}
          </button>
        </div>
        <div className="toolbar-spacer" />
        <span className="todo-count">{plural('todo.open', open, { n: open })}</span>
        <button className="todo-btn" disabled={!anyDone} onClick={() => void api.todos.clearDone().catch(showError)}>
          {t('todo.clearDone')}
        </button>
      </div>
      <div className="todo-scroll">
        {shown.length === 0 && <div className="todo-empty">{t(here ? 'todo.emptyHere' : 'todo.empty')}</div>}
        {shown.map((todo) => {
          const l = linkOf(todo)
          return (
            <TodoItem
              key={todo.id}
              todo={todo}
              editing={editing === todo.id}
              onEditing={(on) => setEditing(on ? todo.id : null)}
              onSave={save}
              onRemove={() => remove(todo.id)}
              onContextMenu={(e) => showItemMenu(todo, e)}
            >
              {l && (
                <button className="todo-link" title={t('todo.linkTitle', { path: l.path })} onClick={() => p.onOpenLink(l)}>
                  <Icon name={l.isDir ? 'folder' : 'document'} size={14} />
                  <span>{baseName(l.path)}</span>
                </button>
              )}
            </TodoItem>
          )
        })}
      </div>
    </div>
  )
}
