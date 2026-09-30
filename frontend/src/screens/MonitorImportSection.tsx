/**
 * Opening the monitoring workbook the company already keeps.
 *
 * The file belongs to the user and stays where it is, in OneDrive. This section
 * reads it so the rows can be checked against reality, and from Phase 5B onward
 * corrected in the browser.
 *
 * The two states are deliberate. The preview comes first and shows the file as
 * it actually is, and editing begins only when the user asks for it. Saving then
 * keeps the changes in the browser for this session only, and says so plainly,
 * because the alternative is the user leaving believing their workbook was
 * updated. Nothing here writes to a file, and the quotation form above is a
 * separate concern: a workbook is never read as a PDF.
 */

import { useId, useState, type ChangeEvent } from 'react'
import type { ImportedMonitor } from '../types/monitor'
import type { EditableMonitorField, MonitorDraftState } from '../state/monitorDraft'
import { changedRowCount, hasUnsavedChanges } from '../state/monitorDraft'
import { MonitorTable } from './MonitorTable'

const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** A read failure worth showing the user, in their language. */
export type MonitorImportError = {
  message: string
  detail: string | null
}

type Props = {
  /** The workbook that was read, shown as a preview and then as an editor. */
  monitor: ImportedMonitor | null
  /** The rows being corrected, and the last set the user confirmed. */
  draft: MonitorDraftState
  /** True while the file is being read, so the section can say so. */
  busy: boolean
  /** Why the last file could not be read, or null. */
  error: MonitorImportError | null
  onImport: (file: File) => void
  onClearError: () => void
  onFieldChange: (index: number, field: EditableMonitorField, value: string) => void
  onSave: () => void
  onCancel: () => void
}

/**
 * Whether a chosen file is one this can read.
 *
 * Checked here so a mis-picked file is caught before it is sent, and worded for
 * someone who has never seen a file extension.
 */
function looksLikeWorkbook(file: File): boolean {
  if (file.name.toLowerCase().endsWith('.xlsx')) return true
  return file.type === XLSX_MEDIA_TYPE
}

/** The lowest sequence in the file, which is where the loaded range starts. */
function lowestSequence(rows: ImportedMonitor['rows']): string | null {
  if (rows.length === 0) return null
  return rows
    .map((row) => row.sequence_number)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0]
}

export function MonitorImportSection({
  monitor,
  draft,
  busy,
  error,
  onImport,
  onClearError,
  onFieldChange,
  onSave,
  onCancel,
}: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [rejection, setRejection] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [savedNotice, setSavedNotice] = useState(false)
  const inputId = useId()
  const headingId = useId()

  const message = rejection ?? error?.message ?? null
  const detail = rejection ? null : (error?.detail ?? null)

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null
    setRejection(null)
    setSavedNotice(false)
    setEditing(false)
    onClearError()

    if (chosen && !looksLikeWorkbook(chosen)) {
      // Caught at the moment of choosing, so the file is never even sent.
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
    // Guarded on `editing` as well as `busy`: opening another workbook resets the
    // rows, so it must not be possible to discard unsaved edits by accident.
    if (busy || editing) return
    if (!file) {
      setRejection('Please choose the monitoring Excel file first.')
      return
    }
    onImport(file)
  }

  function save() {
    onSave()
    setEditing(false)
    setSavedNotice(true)
  }

  function cancel() {
    onCancel()
    setEditing(false)
    setSavedNotice(false)
  }

  const lowest = monitor ? lowestSequence(monitor.rows) : null
  const dirty = hasUnsavedChanges(draft)
  const changed = changedRowCount(draft)

  const picker = (
    <>
      <div className="field">
        <label htmlFor={inputId}>Monitoring Excel file</label>
        <input
          id={inputId}
          type="file"
          accept={`${XLSX_MEDIA_TYPE},.xlsx`}
          disabled={busy || editing}
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

      <button type="button" onClick={submit} disabled={busy || editing}>
        Upload Monitor Excel
      </button>
    </>
  )

  return (
    <section className="monitor-import" aria-labelledby={headingId}>
      <h3 id={headingId}>Continue Existing Monitor</h3>
      <p className="muted">
        Already have a monitoring Excel file? Choose it to see the quotations it contains, and correct
        anything the quotation did not cover. This website reads the file; it never changes it.
      </p>

      {picker}

      {monitor && (
        <div className="monitor-import__toolbar">
          {editing ? (
            <>
              <button type="button" onClick={save}>
                Save changes
              </button>
              <button type="button" onClick={cancel}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setEditing(true)}>
              Edit monitor
            </button>
          )}
        </div>
      )}

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

          {editing && dirty && (
            <p className="notice notice--warning" role="status">
              Unsaved changes: {changed === 1 ? '1 row changed' : `${changed} rows changed`}.
            </p>
          )}

          {savedNotice && !editing && (
            <div className="notice notice--success" role="status">
              <p>Changes saved for this browser session.</p>
              <p>Your Excel file is not changed by this website.</p>
            </div>
          )}

          <div className="table-scroll">
            <MonitorTable
              rows={draft.rows}
              mode={editing ? 'edit' : 'preview'}
              onFieldChange={onFieldChange}
            />
          </div>

          {editing && (
            <p className="muted">
              Sequence numbers are not changed here. Add new work through the quotation form above.
              Save or cancel to choose a different file.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

export default MonitorImportSection
