import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { cameraName, canStripMetadata, formatCoords, formatExposure, hasExifSupport, stripGps, type ExifData } from '@shared/exif'
import { channelsLabel, codecLabel, formatBitrate, formatDuration, formatFps } from '@shared/media'
import { previewKind } from '@shared/preview'
import type { FileEntry } from '@shared/types'
import { dateFormat, numberFormat } from '../lib/format'
import { fetchBytes, readMediaDetails, readPhotoExif, type MediaDetails } from '../lib/mediaInfo'

const api = window.api

type Info = { kind: 'photo'; exif: ExifData | null } | { kind: 'media'; details: MediaDetails }

/** Camera date (local time, no zone) as the user's date and time. */
export function formatTaken(taken: string): string {
  const d = new Date(taken)
  return Number.isNaN(d.getTime()) ? taken : dateFormat('taken', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
}

/** Whether the file has details worth a section in the preview pane. */
export const hasMediaInfo = (entry: FileEntry): boolean => {
  const kind = previewKind(entry.name)
  return !entry.isDir && ((kind === 'image' && hasExifSupport(entry.name)) || kind === 'video' || kind === 'audio')
}

/**
 * Details under the preview: EXIF for photos (camera, date taken, exposure, location with a map link and
 * a button that removes it), duration, tracks and tags for audio and video.
 */
export function MediaInfo({ entry, readOnly, onError }: { entry: FileEntry; readOnly: boolean; onError(err: unknown): void }): React.JSX.Element | null {
  const [info, setInfo] = useState<Info | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const ctrl = new AbortController()
    setInfo(null)
    setFailed(false)
    const load = async (): Promise<Info> =>
      previewKind(entry.name) === 'image'
        ? { kind: 'photo', exif: await readPhotoExif(entry.path, entry.name, entry.size, ctrl.signal) }
        : { kind: 'media', details: await readMediaDetails(entry.path, entry.size) }
    load().then(
      (x) => !ctrl.signal.aborted && setInfo(x),
      () => !ctrl.signal.aborted && setFailed(true)
    )
    return () => ctrl.abort()
  }, [entry])

  const removeGps = async (): Promise<void> => {
    setBusy(true)
    try {
      const out = stripGps(await fetchBytes(entry.path))
      if (out) await api.preview.saveImage(entry.path, out, { modified: entry.modified })
      setInfo((x) => (x?.kind === 'photo' && x.exif ? { kind: 'photo', exif: { ...x.exif, gps: undefined } } : x))
    } catch (err) {
      onError(err)
    } finally {
      setBusy(false)
    }
  }

  if (failed) return null
  if (!info) return <div className="media-info loading">{t('preview.loading')}</div>
  const rows: [string, React.ReactNode][] = []
  const add = (label: string, value: React.ReactNode | undefined | null | false): void => {
    if (value !== undefined && value !== null && value !== false && value !== '') rows.push([label, value])
  }

  if (info.kind === 'photo') {
    const x = info.exif
    if (!x || Object.keys(x).length === 0) return <div className="media-info empty">{t('media.none')}</div>
    add(t('media.taken'), x.taken && formatTaken(x.taken))
    add(t('media.camera'), cameraName(x.make, x.model))
    add(t('media.lens'), x.lens)
    add(
      t('media.exposure'),
      [x.exposure && formatExposure(x.exposure), x.fNumber && `f/${numberFormat(1).format(x.fNumber)}`, x.iso && `ISO ${x.iso}`, x.focalLength && `${numberFormat(1).format(x.focalLength)} mm${x.focal35 ? ` (${x.focal35} mm)` : ''}`]
        .filter(Boolean)
        .join(' · ')
    )
    add(t('media.dimensions'), x.width && x.height && t('preview.dimensions', { width: x.width, height: x.height }))
    add(t('media.software'), x.software)
    if (x.gps) {
      const { lat, lon, alt } = x.gps
      add(
        t('media.location'),
        <>
          <span>{formatCoords(lat, lon)}</span>
          {alt !== undefined && <span>{t('media.altitude', { m: Math.round(alt) })}</span>}
          <span className="media-info-actions">
            <a href={`https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=16/${lat.toFixed(6)}/${lon.toFixed(6)}`} target="_blank" rel="noreferrer">
              {t('media.showMap')}
            </a>
            {!readOnly && canStripMetadata(entry.name) && (
              <button type="button" className="link-button" disabled={busy} onClick={() => void removeGps()}>
                {t('media.removeGps')}
              </button>
            )}
          </span>
        </>
      )
    }
  } else {
    const d = info.details
    add(t('media.songTitle'), d.tags.title)
    add(t('media.artist'), d.tags.artist)
    add(t('media.album'), d.tags.album && `${d.tags.album}${d.tags.year ? ` (${d.tags.year})` : ''}`)
    add(t('media.genre'), d.tags.genre)
    add(t('media.track'), d.tags.track)
    add(t('media.duration'), d.duration !== undefined && formatDuration(d.duration))
    add(t('media.video'), d.width && d.height && [t('preview.dimensions', { width: d.width, height: d.height }), d.fps && formatFps(d.fps), codecLabel(d.videoCodec)].filter(Boolean).join(' · '))
    add(
      t('media.audio'),
      d.audioCodec !== undefined &&
        [codecLabel(d.audioCodec), d.channels && (d.channels === 1 ? t('media.mono') : d.channels === 2 ? t('media.stereo') : t('media.channels', { n: channelsLabel(d.channels) })), d.sampleRate && `${numberFormat(1).format(d.sampleRate / 1000)} kHz`]
          .filter(Boolean)
          .join(' · ')
    )
    add(t('media.bitrate'), d.bitrate && formatBitrate(d.bitrate))
  }
  if (rows.length === 0) return <div className="media-info empty">{t('media.none')}</div>
  return (
    <dl className="media-info">
      {rows.map(([label, value]) => (
        <div key={label} className="media-info-row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
