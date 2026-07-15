interface Props {
  disabled: boolean
  active: boolean
  onToggle: () => void
  label?: string
  activeLabel?: string
}

function NdiOutputControl({
  disabled,
  active,
  onToggle,
  label = 'NDI Output',
  activeLabel = 'Stop NDI Output'
}: Props): React.JSX.Element {
  return (
    <button
      className={`transport-btn ${active ? 'active' : ''}`}
      disabled={disabled}
      onClick={onToggle}
    >
      {active ? activeLabel : label}
    </button>
  )
}

export default NdiOutputControl
