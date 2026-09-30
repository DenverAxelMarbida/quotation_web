/**
 * Screen 1 — Upload.
 *
 * Holds only what belongs to the form: the chosen file and a client-side check
 * that it is a PDF at all. Everything after that is the backend's job, and its
 * answers are passed in.
 *
 * The "Continue Existing Monitor" section lives at the bottom, below everything
 * about starting a new quotation, and is kept out of the `<form>` so choosing a
 * workbook can never be submitted as a quotation PDF. The two are independent:
 * the screen offers both, and neither disturbs the other.
 */

import { useId, useState, type ChangeEvent, type FormEvent } from 'react'
import type { ConfirmedQuotation } from '../types/quotation'
import type { ImportedMonitor } from '../types/monitor'
import type { EditableMonitorField, MonitorDraftState } from '../state/monitorDraft'
import MonitorImportSection from './MonitorImportSection'
import ProcessingScreen from './ProcessingScreen'

/** A failure worth showing a non-technical user, in their language. */
export type UploadError = {
  message: string
  detail: string | null
}

type Props = {
  pending: boolean
  pendingAction?: 'reading' | 'generating' | null
  error: UploadError | null
  onParse: (file: File) => void
  onClearError: () => void
  confirmedQuotations?: ConfirmedQuotation[]
  onViewQuotation?: (index: number) => void
  onGenerateWorkbook?: () => void
  /** A failure from generating the Excel workbook, shown next to the action. */
  generationError?: string | null
  /**
   * Sequence number of the quotation just added to this session. The Excel
   * workbook has not been generated, so this never mentions it being written.
   */
  addedSequence?: string | null
  /** The monitoring workbook that was opened, shown as a read-only preview. */
  importedMonitor?: ImportedMonitor | null
  /** True while a monitoring workbook is being read. */
  monitorPending?: boolean
  /** Why the last monitoring workbook could not be read. */
  monitorError?: UploadError | null
  onImportMonitor?: (file: File) => void
  onClearMonitorError?: () => void
  monitorDraft?: MonitorDraftState
  onMonitorFieldChange?: (index: number, field: EditableMonitorField, value: string) => void
  onSaveMonitor?: () => void
  onCancelMonitor?: () => void
}

/**
 * Accepts a PDF by content type or by extension. Some browsers report no type
 * for a dragged file, so requiring both would reject a genuine PDF.
 */
function looksLikePdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

export default function UploadScreen({ 
  pending, 
  pendingAction = null,
  error, 
  onParse, 
  onClearError,
  confirmedQuotations = [],
  onViewQuotation,
  onGenerateWorkbook,
  generationError = null,
  addedSequence = null,
  importedMonitor = null,
  monitorPending = false,
  monitorError = null,
  onImportMonitor,
  onClearMonitorError = () => {},
  monitorDraft,
  onMonitorFieldChange,
  onSaveMonitor,
  onCancelMonitor,
}: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [rejection, setRejection] = useState<string | null>(null)
  const inputId = useId()

  const confirmedQuotationCount = confirmedQuotations.length
  const confirmedLineItemCount = confirmedQuotations.reduce(
    (sum, quotation) => sum + quotation.quotation.items.length,
    0,
  )
  const monitorRowCount = monitorDraft?.saved.length ?? 0

  // A workbook is built from either source, so either one is enough to offer the
  // action. Re-exporting a monitoring workbook on its own is a real job -- the
  // user opened the file, corrected a row and wants the corrected copy back --
  // and it would be strange to make her invent a quotation to get a file out of
  // the system. With neither source there is nothing to write, so the action is
  // not offered at all.
  const canGenerate = confirmedQuotationCount > 0 || monitorRowCount > 0
  const monitorOnly = confirmedQuotationCount === 0 && monitorRowCount > 0

  const message = rejection ?? error?.message ?? null
  const detail = rejection ? null : (error?.detail ?? null)

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null
    setRejection(null)
    onClearError()

    if (chosen && !looksLikePdf(chosen)) {
      setRejection(
        `${chosen.name} is not a PDF. Please choose the quotation PDF exported from the ERP.`,
      )
      setFile(null)
      return
    }
    setFile(chosen)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!file) {
      setRejection('Please choose a quotation PDF first.')
      return
    }
    onParse(file)
  }

  return (
    <>
      <form className="card" aria-busy={pending} onSubmit={submit}>
      <h2>Upload the quotation</h2>
      <p className="muted">
        Choose the quotation PDF downloaded from the ERP. The details will appear for you to check
        before anything is generated.
      </p>

      <div className="field">
        <label htmlFor={inputId}>Quotation PDF file</label>
        <input
          id={inputId}
          type="file"
          accept="application/pdf,.pdf"
          disabled={pending}
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

      {pending && (
        <ProcessingScreen
          message={
            pendingAction === 'generating'
              ? 'Generating the Excel workbook…'
              : 'Reading the quotation…'
          }
        />
      )}

      <button type="submit" disabled={pending}>
        Read quotation
      </button>

      {addedSequence && (
        <div className="notice notice--success" role="status">
          <strong>Quotation added to session.</strong>
          <p className="notice-detail">
            Sequence {addedSequence} has been assigned. You can upload another quotation or
            generate the Excel workbook.
          </p>
        </div>
      )}

      {canGenerate && onGenerateWorkbook && (
        <section className="session" aria-labelledby="session-heading">
          <h3 id="session-heading">
            {monitorOnly ? 'Export the monitoring workbook' : 'Session quotations'}
          </h3>
          <p className="notice notice--success" role="status">
            <strong>
              {monitorOnly
                ? 'Existing monitor ready to export'
                : confirmedQuotationCount > 0 && monitorRowCount > 0
                  ? 'Ready to generate'
                  : `${confirmedQuotationCount} quotation${confirmedQuotationCount === 1 ? '' : 's'} ready for Excel · ${confirmedLineItemCount} line item${confirmedLineItemCount === 1 ? '' : 's'}`}
            </strong>
            {/* When both sources are present the counts have to name both, or the
                user cannot tell that the rows she has maintained all year are in
                the file. */}
            {confirmedQuotationCount > 0 && monitorRowCount > 0 && (
              <span className="notice-detail">
                {monitorRowCount} existing monitor row{monitorRowCount === 1 ? '' : 's'} ·{' '}
                {confirmedQuotationCount} new quotation{confirmedQuotationCount === 1 ? '' : 's'} ·{' '}
                {confirmedLineItemCount} new line item{confirmedLineItemCount === 1 ? '' : 's'}
              </span>
            )}
            {monitorOnly && (
              <span className="notice-detail">
                {monitorRowCount} monitor row{monitorRowCount === 1 ? '' : 's'} from the workbook you
                opened
              </span>
            )}
          </p>
          {/* The session table lists quotations added here, so with none there is
              nothing to list and an empty table would read as an error. */}
          {confirmedQuotationCount > 0 && (
            <div className="table-scroll">
              <table className="session-table">
                <caption className="visually-hidden">
                  Quotations already added to this session. Use View to check one before generating
                  the workbook.
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="align-center">Seq.</th>
                    <th scope="col">Quotation Number</th>
                    <th scope="col">Client</th>
                    <th scope="col">Project</th>
                    <th scope="col" className="align-center">Items</th>
                    <th scope="col" className="align-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmedQuotations.map((confirmed, index) => (
                    <tr key={`${confirmed.sequence_number}-${index}`}>
                      <td className="align-center">{confirmed.sequence_number}</td>
                      <td>{confirmed.quotation.quotation_number ?? '—'}</td>
                      <td>{confirmed.quotation.client_name ?? '—'}</td>
                      <td>{confirmed.quotation.project_name ?? '—'}</td>
                      <td className="align-center">{confirmed.quotation.items.length}</td>
                      <td className="align-center">
                        <button
                          type="button"
                          className="link-button"
                          aria-label={`View details for sequence ${confirmed.sequence_number}`}
                          onClick={() => onViewQuotation?.(index)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {generationError && (
            <div className="alert alert--danger" role="alert">
              <p className="alert-message">Excel generation failed. Please try again.</p>
              <p className="alert-detail">{generationError}</p>
            </div>
          )}
          <button
            type="button"
            className="primary"
            onClick={onGenerateWorkbook}
            disabled={pending}
          >
            Generate Consolidated Workbook
          </button>
        </section>
      )}
      </form>

      {onImportMonitor && monitorDraft && (
        <MonitorImportSection
          monitor={importedMonitor}
          draft={monitorDraft}
          busy={monitorPending}
          error={monitorError}
          onImport={onImportMonitor}
          onClearError={onClearMonitorError}
          onFieldChange={(index, field, value) => onMonitorFieldChange?.(index, field, value)}
          onSave={() => onSaveMonitor?.()}
          onCancel={() => onCancelMonitor?.()}
        />
      )}
    </>
  )
}
