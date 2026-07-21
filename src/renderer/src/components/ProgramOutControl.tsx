import { useEffect, useState } from 'react'

export interface DisplayInfo {
  id: number
  label: string
  width: number
  height: number
  internal: boolean
  primary: boolean
}

interface Props {
  disabled: boolean
  hideCursor: boolean
  onHideCursorChange: (value: boolean) => void
}

function preferredDisplay(list: DisplayInfo[]): DisplayInfo | undefined {
  return list.find((d) => !d.primary) ?? list[0]
}

function ProgramOutControl({ disabled, hideCursor, onHideCursorChange }: Props): React.JSX.Element {
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    window.api.programOut.listDisplays().then((list) => {
      setDisplays(list)
      setSelectedId(preferredDisplay(list)?.id ?? null)
    })
    return window.api.programOut.onDisplaysChanged((list) => {
      setDisplays(list)
      setSelectedId((current) =>
        current && list.some((d) => d.id === current)
          ? current
          : (preferredDisplay(list)?.id ?? null)
      )
    })
  }, [])

  useEffect(() => {
    window.api.programOut.isOpen().then(setOpen)
    return window.api.programOut.onOpenChanged(setOpen)
  }, [])

  const toggle = (): void => {
    if (open) window.api.programOut.close()
    else if (selectedId !== null) window.api.programOut.open(selectedId)
  }

  return (
    <div className="program-out-control">
      {displays.length > 1 && (
        <select
          className="program-out-display-select"
          value={selectedId ?? ''}
          disabled={open}
          onChange={(e) => setSelectedId(Number(e.target.value))}
        >
          {displays.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label} ({d.width}×{d.height}){d.primary ? ' · Primary' : ''}
            </option>
          ))}
        </select>
      )}
      <button
        className={`transport-btn ${open ? 'active' : ''}`}
        disabled={disabled || (!open && selectedId === null)}
        onClick={toggle}
      >
        {open ? 'Close Program Out' : 'Program Out'}
      </button>
      <label className="program-out-hide-cursor">
        <input
          type="checkbox"
          checked={hideCursor}
          onChange={(e) => onHideCursorChange(e.target.checked)}
        />
        Hide cursor
      </label>
    </div>
  )
}

export default ProgramOutControl
