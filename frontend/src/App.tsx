import { useState } from 'react'
import { apiBaseUrl, fetchHealth } from './lib/api'
import './App.css'

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok'; version: string }
  | { kind: 'error'; message: string }

const PLANNED_SCREENS = [
  'Upload quotation PDF',
  'Processing',
  'Review and correct extracted data',
  'Confirm and download Excel',
]

function App() {
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' })

  async function checkBackend() {
    setCheck({ kind: 'checking' })
    try {
      const health = await fetchHealth()
      setCheck({ kind: 'ok', version: health.version })
    } catch (error) {
      setCheck({ kind: 'error', message: error instanceof Error ? error.message : 'Unknown error' })
    }
  }

  return (
    <main className="page">
      <h1>Quotation to Excel</h1>
      <p className="lead">
        Upload an ERP quotation PDF, check the extracted details, then generate the Excel file.
      </p>

      <section className="card">
        <h2>Screens</h2>
        <ol>
          {PLANNED_SCREENS.map((screen) => (
            <li key={screen}>{screen}</li>
          ))}
        </ol>
        <p className="muted">Only the first and last screen exist so far. The middle screens come next.</p>
      </section>

      <section className="card">
        <h2>Backend connection</h2>
        <p className="muted">API base URL: {apiBaseUrl()}</p>
        <button type="button" onClick={checkBackend} disabled={check.kind === 'checking'}>
          {check.kind === 'checking' ? 'Checking...' : 'Check backend'}
        </button>
        {check.kind === 'ok' && <p className="ok">Backend reachable (v{check.version}).</p>}
        {check.kind === 'error' && <p className="error">Cannot reach backend: {check.message}</p>}
      </section>
    </main>
  )
}

export default App
