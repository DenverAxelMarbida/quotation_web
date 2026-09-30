/**
 * The "Continue Existing Monitor" part of the upload screen.
 *
 * The monitoring workbook is the work state that outlives this application: the
 * user keeps it in OneDrive, shares it with coworkers, and comes back to it days
 * later. This section opens one so the user can see what it already holds.
 *
 * It is a viewer, not a form. The workbook belongs to the user and is the record
 * of record, so nothing here edits a value, writes back, or offers to continue
 * from what was read. Every cell is shown as the file stores it, including the
 * blanks: a gap in the preview is a gap in the workbook, and hiding it would
 * make the file look more complete than it is.
 */

import { useId, useState, type ChangeEvent } from 'react'
import type { ImportedMonitor, ImportedMonitorRow } from '../types/monitor'

/** A failure worth showing a non-technical user, in their language. */
type MonitorImportError = {
  message: string
  detail: string | null
}

type Props = {
  /** The workbook that was read, shown as a read-only preview. */
  monitor: ImportedMonitor | null
  /** True while the file is being read, so the section can say so. */
  busy: boolean
  /** Why the last file could not be read, or null. */
  error: MonitorImportError | null
  onImport: (file: File) => void
  onClearError: () => void
}

const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Accepts a workbook by content type or by extension. A saved-as-legacy `.xls`
 * or a renamed `.csv` is refused here rather than after the upload, but the
 * backend still opens whatever arrives, because the name proves nothing.
 */
function looksLikeWorkbook(file: File): boolean {
  return file.type === XLSX_MEDIA_TYPE || file.name.toLowerCase().endsWith('.xlsx')
}

/** Shown for a cell the workbook left empty, so the gap is visible. */
const EMPTY_CELL = '—'

function Cell({ value }: { value: string | number | null }) {
  const empty = value === null || value === '' || value === undefined
  return <>{empty ? EMPTY_CELL : value}</>
}

/**
 * The lowest sequence number present, for the summary line.
 *
 * Compared as a number so the range starts at the first project rather than
 * whichever identifier happens to sort first as text.
 */
function lowestSequence(rows: ImportedMonitorRow[]): string | null {
  let lowest: { value: number; text: string } | null = null
  for (const row of rows) {
    const value = Number.parseInt(row.sequence_number, 10)
    if (!Number.isFinite(value)) continue
    if (lowest === null || value < lowest.value) {
      lowest = { value, text: row.sequence_number }
    }
  }
  return lowest?.text ?? null
}

export default function MonitorImportSection({
  monitor,
  busy,
  error,
  onImport,
  onClearError,
}: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [rejection, setRejection] = useState<string | null>(null)
  const inputId = useId()
  const headingId = useId()

  const message = rejection ?? error?.message ?? null
  const detail = rejection ? null : (error?.detail ?? null)

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null
    setRejection(null)
    onClearError()

    if (chosen && !looksLikeWorkbook(chosen)) {
      setRejection(
        `${chosen.name} is not a monitoring Excel file. Please choose the ` +
          'monitoring .xlsx file you generated earlier.',
      )
      setFile(null)
      return
    }
    setFile(chosen)
  }

  function submit() {
    if (busy) return
    if (!file) {
      setRejection('Please choose the monitoring Excel file first.')
      return
    }
    onImport(file)
  }

  const lowest = monitor ? lowestSequence(monitor.rows) : null

  return (
    <section className="monitor-import" aria-labelledby={headingId}>
      <h3 id={headingId}>Continue Existing Monitor</h3>
      <p className="muted">
        Already have a monitoring Excel file? Choose it to see the quotations it contains before you
        add anything new.
      </p>

      <div className="field">
        <label htmlFor={inputId}>Monitoring Excel file</label>
        <input
          id={inputId}
          type="file"
          accept={`${XLSX_MEDIA_TYPE},.xlsx`}
          disabled={busy}
          onChange={choose}
        />
        {file && (
          <p className="chosen-file">
            Selected: <span>{file.name}</span>
          </p>
        )}
      </div>

      {message && (
        <div className="alert" role="alert">
          <p className="alert-message">{message}</p>
          {detail && <p className="alert-detail">{detail}</p>}
        </div>
      )}

      {busy && <p className="muted">Reading the monitoring file…</p>}

      <button type="button" onClick={submit} disabled={busy}>
        Upload Monitor Excel
      </button>

      {monitor && (
        <div className="monitor-preview">
          <p className="notice notice--success" role="status">
            <strong>Existing Monitor Loaded</strong>
            <span className="notice-detail">
              {' '}
              {monitor.source_filename} · {monitor.row_count} row
              {monitor.row_count === 1 ? '' : 's'}
              {lowest && monitor.highest_sequence
                ? ` · Sequences ${lowest}–${monitor.highest_sequence}`
                : ''}
            </span>
          </p>

          <div className="table-scroll">
            <table className="session-table monitor-table">
              <caption className="visually-hidden">
                Rows found in the uploaded monitoring workbook. This is a read-only view; nothing
                here has been changed.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="align-center">Seq.</th>
                  <th scope="col">Client</th>
                  <th scope="col">Project</th>
                  <th scope="col">Product</th>
                  <th scope="col" className="align-right">Qty</th>
                  <th scope="col">Unit</th>
                  <th scope="col">Installation Schedule</th>
                  <th scope="col">Start Date</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {monitor.rows.map((row, index) => (
                  <tr key={`${row.sequence_number}-${index}`}>
                    <td className="align-center">{row.sequence_number}</td>
                    <td><Cell value={row.client_name} /></td>
                    <td><Cell value={row.project_name} /></td>
                    <td><Cell value={row.product_description} /></td>
                    <td className="align-right"><Cell value={row.quantity} /></td>
                    <td><Cell value={row.unit_of_measurement} /></td>
                    <td><Cell value={row.installation_schedule} /></td>
                    <td><Cell value={row.start_date} /></td>
                    <td><Cell value={row.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
