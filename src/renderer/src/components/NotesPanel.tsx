interface Props {
  currentPage: number
  notes: string
  onChange: (text: string) => void
}

function NotesPanel({ currentPage, notes, onChange }: Props): React.JSX.Element {
  return (
    <div className="notes-panel">
      <div className="panel-heading">Presenter Notes — Slide {currentPage}</div>
      <textarea
        className="notes-textarea"
        value={notes}
        placeholder="Notes for this slide…"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

export default NotesPanel
