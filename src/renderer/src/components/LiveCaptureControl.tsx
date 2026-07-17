import { useEffect, useState } from 'react'
import type { CropRect } from '../liveCapture'

interface CaptureSourceInfo {
  id: string
  name: string
  thumbnailDataUrl: string
}

type PermissionStatus = 'granted' | 'denied' | 'restricted' | 'unknown' | 'not-determined'

interface Props {
  label: string
  disabled: boolean
  active: boolean
  onStart: (sourceId: string, crop: CropRect | null) => void
  onStop: () => void
}

const DEFAULT_CROP: CropRect = { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }

function LiveCaptureControl({
  label,
  disabled,
  active,
  onStart,
  onStop
}: Props): React.JSX.Element {
  const [sources, setSources] = useState<CaptureSourceInfo[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [permission, setPermission] = useState<PermissionStatus>('unknown')
  const [cropEnabled, setCropEnabled] = useState(false)
  const [crop, setCrop] = useState<CropRect>(DEFAULT_CROP)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    window.api.screenCapture.permissionStatus().then(setPermission)
  }, [])

  useEffect(() => {
    if (!expanded) return
    window.api.screenCapture.listSources().then((list) => {
      setSources(list)
      setSelectedId((current) => current ?? list[0]?.id ?? null)
    })
  }, [expanded])

  const toggle = (): void => {
    if (active) {
      onStop()
      return
    }
    if (!selectedId) return
    onStart(selectedId, cropEnabled ? crop : null)
  }

  if (permission !== 'granted') {
    return (
      <div className="live-capture-control live-capture-control--blocked">
        <span className="live-capture-blocked-label">
          {label}: Screen Recording permission needed
        </span>
        <button
          className="transport-btn"
          onClick={() => window.api.screenCapture.openPermissionSettings()}
        >
          Open Settings…
        </button>
      </div>
    )
  }

  return (
    <div className="live-capture-control">
      <button
        className="icon-btn"
        title={`${label} live capture options`}
        onClick={() => setExpanded((v) => !v)}
        disabled={active}
      >
        ⚙
      </button>
      {expanded && !active && (
        <div className="live-capture-panel">
          <select value={selectedId ?? ''} onChange={(e) => setSelectedId(e.target.value)}>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="live-capture-crop-toggle">
            <input
              type="checkbox"
              checked={cropEnabled}
              onChange={(e) => setCropEnabled(e.target.checked)}
            />
            Crop to region (for isolating next-slide/notes area within a captured Presenter Display)
          </label>
          {cropEnabled && (
            <div className="live-capture-crop-fields">
              <label>
                X%
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={crop.xPct}
                  onChange={(e) => setCrop({ ...crop, xPct: Number(e.target.value) })}
                />
              </label>
              <label>
                Y%
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={crop.yPct}
                  onChange={(e) => setCrop({ ...crop, yPct: Number(e.target.value) })}
                />
              </label>
              <label>
                W%
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={crop.widthPct}
                  onChange={(e) => setCrop({ ...crop, widthPct: Number(e.target.value) })}
                />
              </label>
              <label>
                H%
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={crop.heightPct}
                  onChange={(e) => setCrop({ ...crop, heightPct: Number(e.target.value) })}
                />
              </label>
            </div>
          )}
        </div>
      )}
      <button
        className={`transport-btn ${active ? 'active' : ''}`}
        disabled={disabled || (!active && !selectedId)}
        onClick={toggle}
      >
        {active ? `Stop Live ${label}` : `Live ${label}…`}
      </button>
    </div>
  )
}

export default LiveCaptureControl
