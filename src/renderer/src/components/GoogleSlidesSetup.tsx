import { useEffect, useState } from 'react'

interface OAuthStatus {
  configured: boolean
  clientId: string | null
  extensionId: string
}

interface Props {
  onClose: () => void
}

function GoogleSlidesSetup({ onClose }: Props): React.JSX.Element {
  const [status, setStatus] = useState<OAuthStatus | null>(null)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.googleSlidesSetup.getStatus().then(setStatus)
  }, [])

  const save = async (): Promise<void> => {
    setError(null)
    setSaving(true)
    try {
      await window.api.googleSlidesSetup.setClientId(input)
      const next = await window.api.googleSlidesSetup.getStatus()
      setStatus(next)
      setInput('')
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Google Slides OAuth Setup</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className={`setup-status ${status?.configured ? 'ok' : 'pending'}`}>
            {status === null
              ? 'Checking current setup…'
              : status.configured
                ? `✓ Configured — client ID ends in …${status.clientId?.split('.')[0].slice(-6)}`
                : 'Not yet configured — speaker notes will fail to load until this is set up.'}
          </div>

          <p>
            Fetching speaker notes needs a one-time Google Cloud OAuth client registered against
            this extension&apos;s fixed ID. This only needs to be done once per Google account.
          </p>

          <ol className="setup-steps">
            <li>
              Open{' '}
              <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">
                Google Cloud Console
              </a>{' '}
              and create a project (any name, e.g. &quot;Presentation Commander&quot;).
            </li>
            <li>
              <em>APIs &amp; Services → Library</em> — search &quot;Google Slides API&quot; →
              Enable.
            </li>
            <li>
              <em>APIs &amp; Services → OAuth consent screen</em> — User type: External, add your
              own Google account under Test users.
            </li>
            <li>
              <em>APIs &amp; Services → Credentials → Create Credentials → OAuth client ID</em> —
              Application type: <strong>Chrome Extension</strong>, Application ID:{' '}
              <code className="setup-code">
                {status?.extensionId ?? 'kibkdbmpbeoapaagoiffjlmgnhambklk'}
              </code>
            </li>
            <li>Paste the resulting Client ID below.</li>
          </ol>

          <div className="setup-input-row">
            <input
              className="connection-input setup-client-id-input"
              placeholder="123456789-abc...apps.googleusercontent.com"
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                setSaved(false)
                setError(null)
              }}
            />
            <button className="transport-btn" disabled={!input.trim() || saving} onClick={save}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>

          {error && <div className="setup-message error">{error}</div>}
          {saved && !error && (
            <div className="setup-message ok">
              Saved. Reload the extension at <code className="setup-code">chrome://extensions</code>{' '}
              to apply it.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default GoogleSlidesSetup
