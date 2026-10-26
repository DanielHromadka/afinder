import { useEffect, useState } from 'react'
import { t, tos } from '@shared/i18n'
import type { Favorite, FileEntry, FileKind, Place, SizeUpdate } from '@shared/types'
import type { RemoteMount } from '@shared/remote'
import type { RecentFile } from '@shared/recents'
import { baseName } from '@shared/paths'
import { formatDate, formatRelative, formatSize } from '@renderer/lib/format'
import { kindLabel } from '@renderer/lib/kinds'
import { folderLabel } from '@renderer/lib/places'
import { Icon, type IconName } from './Icon'

interface Props {
  currentPath: string
  selected: FileEntry[]
  places: Place[]
  favorites: Favorite[]
  onOpenFavorite(fav: Favorite): void
  onFavoriteMenu(fav: Favorite, e: React.MouseEvent): void
  remotes: RemoteMount[]
  onOpenRemote(mount: RemoteMount): void
  onRemoteMenu(mount: RemoteMount, e: React.MouseEvent): void
  onAddRemote(): void
  /** Pairs another computer with aFinder (its files and remote desktop). */
  onAddComputer(): void
  sizes: Map<string, SizeUpdate>
  onNavigate(path: string): void
  onNewFolder(): void
  onTerminal(): void
  onRename(): void
  onTrash(): void
  onReveal(): void
  onCopyPath(): void
  onCopy(): void
  onPaste(): void
  recentEnabled: boolean
  /** Shows the file in its folder. */
  onOpenRecent(path: string): void
  onLaunchRecent(path: string): void
  onRecentMenu(path: string, e: React.MouseEvent): void
  onScreenshot(e: React.MouseEvent): void
}

/** The recent list from main, refreshed whenever any window touches a file. */
function useRecents(enabled: boolean): (RecentFile & { kind: FileKind })[] {
  const [list, setList] = useState<(RecentFile & { kind: FileKind })[]>([])
  useEffect(() => {
    if (!enabled) return setList([])
    let live = true
    const load = (): void => void window.api.recents.list().then((l) => live && setList(l), () => {})
    load()
    const off = window.api.recents.onChanged(load)
    return () => {
      live = false
      off()
    }
  }, [enabled])
  return list
}

function Section(props: { title: string; children: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <section className={`task-section${open ? '' : ' collapsed'}`}>
      <button className="task-header" onClick={() => setOpen(!open)}>
        <span>{props.title}</span>
        <span className="chevron">{open ? '︽' : '︾'}</span>
      </button>
      {open && <div className="task-body">{props.children}</div>}
    </section>
  )
}

function TaskLink(props: {
  icon: IconName
  label: string
  title?: string
  className?: string
  disabled?: boolean
  onClick(e: React.MouseEvent): void
  onContextMenu?(e: React.MouseEvent): void
}): React.JSX.Element {
  return (
    <button className={`task-link${props.className ? ` ${props.className}` : ''}`} title={props.title} disabled={props.disabled} onClick={props.onClick} onContextMenu={props.onContextMenu}>
      <Icon name={props.icon} size={16} />
      <span>{props.label}</span>
    </button>
  )
}

export function TaskPane(p: Props): React.JSX.Element {
  const one = p.selected.length === 1 ? p.selected[0] : null
  const none = p.selected.length === 0
  const currentName = folderLabel(p.currentPath)
  const recents = useRecents(p.recentEnabled)

  return (
    <aside className="taskpane">
      <Section title={t('tasks.title')}>
        <TaskLink icon="newFolder" label={t('action.createFolder')} onClick={p.onNewFolder} />
        <TaskLink icon="terminal" label={tos('action.terminal')} onClick={p.onTerminal} />
        <TaskLink
          icon="rename"
          label={p.selected.length > 1 ? t('action.renameMany', { n: p.selected.length }) : t('action.rename')}
          disabled={none}
          onClick={p.onRename}
        />
        <TaskLink icon="reveal" label={tos('action.reveal')} disabled={none} onClick={p.onReveal} />
        <TaskLink icon="copy" label={t('action.copy')} disabled={none} onClick={p.onCopy} />
        <TaskLink icon="open" label={t('action.pasteHere')} onClick={p.onPaste} />
        <TaskLink icon="copy" label={t('action.copyPath')} onClick={p.onCopyPath} />
        <TaskLink icon="trash" label={tos('action.trash')} disabled={none} onClick={p.onTrash} />
        <TaskLink icon="image" label={t('screenshot.title')} title={t('screenshot.hint')} onClick={p.onScreenshot} />
      </Section>

      {p.recentEnabled && (
        <Section title={t('recent.title')}>
          {recents.length === 0 ? (
            <div className="task-note">{t('recent.empty')}</div>
          ) : (
            recents.slice(0, 8).map((r) => (
              <button
                key={r.path}
                className="task-link recent-link"
                title={`${r.path}\n${t(`recent.action.${r.action}`)} ${formatDate(r.at)}`}
                onClick={() => p.onOpenRecent(r.path)}
                onDoubleClick={() => p.onLaunchRecent(r.path)}
                onContextMenu={(e) => p.onRecentMenu(r.path, e)}
              >
                <Icon name={r.kind} size={16} />
                <span>{baseName(r.path)}</span>
                <small>{formatRelative(r.at)}</small>
              </button>
            ))
          )}
        </Section>
      )}

      <Section title={t('tasks.favorites')}>
        {p.favorites.length === 0 ? (
          <div className="task-note">{t('tasks.favoritesEmpty')}</div>
        ) : (
          p.favorites.map((fav) => (
            <TaskLink
              key={fav.path}
              icon={fav.kind}
              label={fav.isDir ? folderLabel(fav.path) : baseName(fav.path)}
              title={fav.path}
              onClick={() => p.onOpenFavorite(fav)}
              onContextMenu={(e) => p.onFavoriteMenu(fav, e)}
            />
          ))
        )}
      </Section>

      <Section title={t('tasks.computers')}>
        {p.remotes
          .filter((m) => m.connection.type === 'afinder')
          .map((m) => (
            <TaskLink
              key={m.connection.id}
              icon="desktop"
              label={m.connection.name}
              title={t('tasks.computerHint')}
              className={m.connected ? 'connected' : undefined}
              onClick={() => p.onOpenRemote(m)}
              onContextMenu={(e) => p.onRemoteMenu(m, e)}
            />
          ))}
        <TaskLink icon="desktop" label={t('computers.connect')} onClick={p.onAddComputer} />
      </Section>

      <Section title={t('tasks.remote')}>
        {p.remotes.filter((m) => m.connection.type !== 'afinder').map((m) => (
          <TaskLink
            key={m.connection.id}
            icon="remote"
            label={m.connection.name}
            title={m.url}
            className={m.connected ? 'connected' : undefined}
            onClick={() => p.onOpenRemote(m)}
            onContextMenu={(e) => p.onRemoteMenu(m, e)}
          />
        ))}
        <TaskLink icon="newFolder" label={t('remote.add')} onClick={p.onAddRemote} />
      </Section>

      <Section title={t('tasks.places')}>
        {p.places.map((place) => (
          <TaskLink key={place.path} icon={place.icon} label={place.name} onClick={() => p.onNavigate(place.path)} />
        ))}
      </Section>

      <Section title={t('tasks.details')}>
        {one ? (
          <Details entry={one} size={one.isDir || one.kind === 'app' ? p.sizes.get(one.path) : undefined} />
        ) : (
          <div className="details">
            <strong>{none ? currentName : t('details.selectedCount', { n: p.selected.length })}</strong>
            <span>{none ? t('kind.folder') : ''}</span>
          </div>
        )}
      </Section>
    </aside>
  )
}

function Details({ entry, size }: { entry: FileEntry; size?: SizeUpdate }): React.JSX.Element {
  const bytes = entry.size ?? size?.size
  return (
    <div className="details">
      <strong>{entry.name}</strong>
      <span>{kindLabel(entry)}</span>
      <span>{t('details.modified', { date: formatDate(entry.modified) })}</span>
      {bytes !== undefined && (
        <span>
          {t('details.size', { size: formatSize(bytes) })}
          {size?.state === 'partial' ? t('status.computing') : ''}
        </span>
      )}
      {entry.isSymlink && <span>{t('details.symlink')}</span>}
    </div>
  )
}
