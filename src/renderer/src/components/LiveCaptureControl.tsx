import { useEffect, useState } from 'react'
import type { CropRect } from '../liveCapture'
import { detectSlideRegions } from '../regionDetect'
import type { DetectedRegion } from '../regionDetect'

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
  /** Applies a new crop to an already-running capture (no restart needed — crop is applied at draw time). */
  onRecrop: (crop: CropRect | null) => void
  /** Grabs a full, uncropped snapshot of what this stream's capture currently sees, for region detection. Null if not active yet. */
  getSnapshot: () => HTMLCanvasElement | null
  /** The open deck's slide aspect ratio, if known — enables the "Detect Regions" button. */
  slideAspectRatio: number | null
}

const DEFAULT_CROP: CropRect = { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }

function LiveCaptureControl({
  label,
  disabled,
  active,
  onStart,
  onStop,
  onRecrop,
  getSnapshot,
  slideAspectRatio
}: Props): React.JSX.Element {
  const [sources, setSources] = useState<CaptureSourceInfo[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [permission, setPermission] = useState<PermissionStatus>('unknown')
  const [cropEnabled, setCropEnabled] = useState(false)
  const [crop, setCrop] = useState<CropRect>(DEFAULT_CROP)
  const [expanded, setExpanded] = useState(false)
  const [detected, setDetected] = useState<DetectedRegion[] | null>(null)

  useEffect(() => {
    window.api.screenCapture.permissionStatus().then(setPermission)
  }, [])

  useEffect(() => {
    if (!expanded || active) return
    window.api.screenCapture.listSources().then((list) => {
      setSources(list)
      setSelectedId((current) => current ?? list[0]?.id ?? null)
    })
  }, [expanded, active])

  const toggle = (): void => {
    if (active) {
      onStop()
      setDetected(null)
      return
    }
    if (!selectedId) return
    onStart(selectedId, cropEnabled ? crop : null)
  }

  // Crop is applied at draw time in the running capture, so while active,
  // any edit here takes effect on the next frame — no restart needed.
  const updateCrop = (next: CropRect): void => {
    setCrop(next)
    if (active && cropEnabled) onRecrop(next)
  }

  const toggleCropEnabled = (checked: boolean): void => {
    setCropEnabled(checked)
    if (active) onRecrop(checked ? crop : null)
  }

  const runDetection = (): void => {
    if (!slideAspectRatio) return
    const snapshot = getSnapshot()
    if (!snapshot) return
    setDetected(detectSlideRegions(snapshot, slideAspectRatio).slice(0, 4))
  }

  const applyDetected = (region: DetectedRegion): void => {
    setCropEnabled(true)
    updateCrop(region.crop)
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
      >
        ⚙
      </button>
      {expanded && (
        <div className="live-capture-panel">
          {!active && (
            <select value={selectedId ?? ''} onChange={(e) => setSelectedId(e.target.value)}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <label className="live-capture-crop-toggle">
            <input
              type="checkbox"
              checked={cropEnabled}
              onChange={(e) => toggleCropEnabled(e.target.checked)}
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
                  onChange={(e) => updateCrop({ ...crop, xPct: Number(e.target.value) })}
                />
              </label>
              <label>
                Y%
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={crop.yPct}
                  onChange={(e) => updateCrop({ ...crop, yPct: Number(e.target.value) })}
                />
              </label>
              <label>
                W%
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={crop.widthPct}
                  onChange={(e) => updateCrop({ ...crop, widthPct: Number(e.target.value) })}
                />
              </label>
              <label>
                H%
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={crop.heightPct}
                  onChange={(e) => updateCrop({ ...crop, heightPct: Number(e.target.value) })}
                />
              </label>
            </div>
          )}
          {active && slideAspectRatio && (
            <div className="live-capture-detect">
              <button className="transport-btn" onClick={runDetection}>
                Detect Regions
              </button>
              {detected && detected.length === 0 && (
                <span className="live-capture-detect-empty">No slide-shaped regions found.</span>
              )}
              {detected && detected.length > 0 && (
                <div className="live-capture-detect-results">
                  {detected.map((region, i) => (
                    <button
                      key={i}
                      className="live-capture-detect-candidate"
                      onClick={() => applyDetected(region)}
                    >
                      Region {i + 1} — {Math.round(region.areaPct)}% of frame
                    </button>
                  ))}
                </div>
              )}
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
