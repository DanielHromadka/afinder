import { useRef } from 'react'
import { t } from '@shared/i18n'
import { MAX_TODO_TEXT, type Todo } from '@shared/todos'

export const newTodoId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Ticks the item off or reopens it. */
export const toggled = (todo: Todo): Todo => ({ ...todo, done: !todo.done, doneAt: todo.done ? undefined : Date.now() })

interface Props {
  todo: Todo
  /** Edit mode is driven from outside, so a context menu can start it too. */
  editing: boolean
  onEditing(on: boolean): void
  onSave(todo: Todo): void
  onRemove(): void
  onContextMenu?(e: React.MouseEvent): void
  /** Extra lines under the text, e.g. the linked file. */
  children?: React.ReactNode
}

/** One to-do: checkbox, text (double-click to edit) and a delete button; shared by the Todo area and the file popover. */
export function TodoItem(p: Props): React.JSX.Element {
  const { todo } = p
  const input = useRef<HTMLInputElement>(null)
  const commit = (): void => {
    const clean = input.current?.value.trim()
    if (clean && clean !== todo.text) p.onSave({ ...todo, text: clean })
    p.onEditing(false)
  }
  return (
    <div className={`todo-item${todo.done ? ' done' : ''}`} onContextMenu={p.onContextMenu}>
      <input type="checkbox" checked={todo.done} title={t(todo.done ? 'todo.markOpen' : 'todo.markDone')} onChange={() => p.onSave(toggled(todo))} />
      <div className="todo-body">
        {p.editing ? (
          <input
            className="todo-edit"
            ref={input}
            autoFocus
            defaultValue={todo.text}
            maxLength={MAX_TODO_TEXT}
            onBlur={commit}
            onKeyDown={(e) => (e.key === 'Enter' ? commit() : e.key === 'Escape' && (e.stopPropagation(), p.onEditing(false)))}
          />
        ) : (
          <span className="todo-text" onDoubleClick={() => p.onEditing(true)}>
            {todo.text}
          </span>
        )}
        {p.children}
      </div>
      <button className="todo-del" title={t('todo.delete')} onClick={p.onRemove}>
        ×
      </button>
    </div>
  )
}
