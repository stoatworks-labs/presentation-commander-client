import type { ConnectionStatus } from '../../../shared/protocol'

interface Props {
  status: ConnectionStatus
  host: string
  name: string
  onHostChange: (host: string) => void
  onNameChange: (name: string) => void
  onConnect: () => void
  onDisconnect: () => void
}

const statusLabel: Record<ConnectionStatus, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
  error: 'Connection Error'
}

const statusDotClass: Record<ConnectionStatus, string> = {
  disconnected: 'offline',
  connecting: 'pending',
  connected: 'online',
  error: 'offline'
}

function ConnectionPanel({
  status,
  host,
  name,
  onHostChange,
  onNameChange,
  onConnect,
  onDisconnect
}: Props): React.JSX.Element {
  const connected = status === 'connected' || status === 'connecting'

  return (
    <div className="connection-panel">
      <span className={`status-dot ${statusDotClass[status]}`} />
      <span className="connection-status-label">{statusLabel[status]}</span>
      <input
        className="connection-input"
        placeholder="Client name"
        value={name}
        disabled={connected}
        onChange={(e) => onNameChange(e.target.value)}
      />
      <input
        className="connection-input"
        placeholder="host:port"
        value={host}
        disabled={connected}
        onChange={(e) => onHostChange(e.target.value)}
      />
      {connected ? (
        <button className="transport-btn ghost" onClick={onDisconnect}>
          Disconnect
        </button>
      ) : (
        <button className="transport-btn" onClick={onConnect}>
          Connect
        </button>
      )}
    </div>
  )
}

export default ConnectionPanel
