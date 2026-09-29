/**
 * The workflow, and the only place that calls the API.
 *
 * AGENTS.md section 8 describes four screens; this is the small state machine
 * that moves between them. Screens are presentational and receive everything
 * they need, so editing and rendering rules stay out of the network layer and
 * out of each other.
 *
 * A failed parse clears the previous result on purpose. Showing a previous
 * quotation's details next to a new file's error would invite the reader to
 * confirm the wrong document (AGENTS.md section 9).
 */

import { useState } from 'react'
import { ApiError } from './api/client'
import {
  generateConsolidatedExcel,
  parseQuotation,
} from './api/quotations'
import CompletedScreen from './screens/CompletedScreen'
import ReviewScreen from './screens/ReviewScreen'
import UploadScreen, { type UploadError } from './screens/UploadScreen'
import {
  findDuplicateFingerprint,
  findDuplicateQuotationNumber,
  findDuplicateSequence,
  fingerprintFile,
  nextSequenceNumber,
} from './state/session'
import type {
  ConfirmedQuotation,
  ConsolidatedWorkbookRequest,
  Quotation,
  QuotationPreview,
} from './types/quotation'
import './App.css'

type Stage =
  | 'upload'
  | 'review'
  | 'review-with-sequence'
  | 'preview'
  | 'completed'

/**
 * The read-only view of a quotation already in the session. Its review flags
 * were answered when it was confirmed, so there is nothing left to review.
 */
function toPreview(confirmed: ConfirmedQuotation): QuotationPreview {
  return {
    quotation: confirmed.quotation,
    review: [],
    source: confirmed.source ?? {
      filename: 'saved in this session',
      page_count: 0,
      warnings: [],
    },
  }
}

function toUploadError(cause: unknown): UploadError {
  if (cause instanceof ApiError) {
    return { message: cause.message, detail: cause.detail }
  }
  return {
    message: 'The quotation could not be read. Check that the backend is running, then try again.',
    detail: null,
  }
}

export default function App() {
  const [stage, setStage] = useState<Stage>('upload')
  const [preview, setPreview] = useState<QuotationPreview | null>(null)
  const [error, setError] = useState<UploadError | null>(null)
  const [pending, setPending] = useState(false)
  /** Which slow action is running, so the waiting copy names the right one. */
  const [pendingAction, setPendingAction] = useState<'reading' | 'generating' | null>(null)
  const [excelBlob, setExcelBlob] = useState<Blob | null>(null)
  const [excelError, setExcelError] = useState<string | null>(null)
  const [confirmedQuotations, setConfirmedQuotations] = useState<
    ConfirmedQuotation[]
  >([])
  /**
   * The fingerprint of the PDF currently being reviewed, held until a sequence
   * number is assigned so the confirmed quotation can be recognised later.
   */
  const [pendingFingerprint, setPendingFingerprint] = useState<string | null>(null)
  /** Which confirmed quotation the session preview is showing. */
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  /**
   * The sequence number of the quotation most recently added, so the upload
   * screen can say what happened. It is about this session only: the Excel
   * workbook has not been generated at this point.
   */
  const [lastAddedSequence, setLastAddedSequence] = useState<string | null>(null)

  /**
   * `useQuotationDraft` seeds its reducer on mount, so a second upload needs a
   * fresh component or it would inherit the previous quotation's edits.
   */
  const [draftId, setDraftId] = useState(0)

  async function readQuotation(file: File) {
    if (pending) return
    setPending(true)
    setPendingAction('reading')
    setError(null)
    setExcelError(null)
    setLastAddedSequence(null)
    setPreview(null)
    try {
      // Recognise the exact same file before spending time parsing it.
      const fingerprint = await fingerprintFile(file)
      if (findDuplicateFingerprint(confirmedQuotations, fingerprint)) {
        setError({
          message: 'This quotation has already been added to this session.',
          detail: null,
        })
        return
      }

      const result = await parseQuotation(file)

      // The ERP quotation number identifies the document; client and project
      // names alone do not.
      const duplicate = findDuplicateQuotationNumber(
        confirmedQuotations,
        result.quotation.quotation_number,
      )
      if (duplicate) {
        setError({
          message: `Quotation ${result.quotation.quotation_number} has already been added to this session.`,
          detail: null,
        })
        return
      }

      setPendingFingerprint(fingerprint)
      setPreview(result)
      setDraftId((id) => id + 1)
      setStage('review')
    } catch (cause) {
      setError(toUploadError(cause))
    } finally {
      setPending(false)
      setPendingAction(null)
    }
  }

  function handleReviewConfirm(_quotation: Quotation) {
    // Move to the sequence step; nothing is committed yet.
    setStage('review-with-sequence')
  }

  function handleSequenceConfirm(quotation: Quotation) {
    // The number the person was shown. Recomputed here rather than passed by the
    // screen, so a cancelled draft can never consume one.
    const sequenceNumber = nextSequenceNumber(confirmedQuotations)

    // The number is derived, so this cannot normally fire; guard anyway so a
    // duplicate can never reach the workbook.
    if (findDuplicateSequence(confirmedQuotations, sequenceNumber)) {
      setExcelError(
        `Sequence number ${sequenceNumber} is already assigned. Please choose a different sequence number.`,
      )
      return
    }

    // Add to the in-memory session, then start the next quotation. The session
    // survives this reset so earlier quotations are never lost.
    setConfirmedQuotations((prev) => [
      ...prev,
      {
        sequence_number: sequenceNumber,
        quotation,
        fingerprint: pendingFingerprint ?? undefined,
        source: preview?.source,
      },
    ])
    setPendingFingerprint(null)
    setExcelError(null)
    setPreview(null)
    setLastAddedSequence(sequenceNumber)
    setDraftId((id) => id + 1)
    setStage('upload')
  }

  async function generateConsolidatedWorkbook() {
    if (pending) return
    setPending(true)
    setPendingAction('generating')
    setExcelError(null)
    setExcelBlob(null)
    try {
      // Strip app-only fields: the backend model forbids unknown properties.
      const request: ConsolidatedWorkbookRequest = {
        quotations: confirmedQuotations.map(({ sequence_number, quotation }) => ({
          sequence_number,
          quotation,
        })),
      }
      const blob = await generateConsolidatedExcel(request)
      setExcelBlob(blob)
      setStage('completed')
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Failed to generate Excel workbook'
      setExcelError(message)
    } finally {
      setPending(false)
      setPendingAction(null)
    }
  }

  /**
   * Drop the quotation currently being read, without touching the session.
   *
   * Cancelling is not a session reset: every quotation already confirmed keeps
   * its place and its number, and no sequence number is consumed, because the
   * next number is derived from the confirmed quotations rather than a counter.
   */
  function cancelDraft() {
    setStage('upload')
    setPreview(null)
    setError(null)
    setExcelError(null)
    setPendingFingerprint(null)
    setPreviewIndex(null)
    setLastAddedSequence(null)
    setDraftId((id) => id + 1)
  }

  function startAnother() {
    // Continue the session: keep every quotation already confirmed and reset
    // only the working draft, so the next PDF is added to the same workbook.
    // The current draft and sequence input reset because going back to upload
    // unmounts the review screen, which owns the sequence number.
    setStage('upload')
    setPreview(null)
    setError(null)
    setExcelBlob(null)
    setExcelError(null)
    setPendingFingerprint(null)
    setPreviewIndex(null)
    setLastAddedSequence(null)
  }

  function resetSession() {
    // Start fresh: discard the whole session, including confirmed quotations.
    setConfirmedQuotations([])
    setStage('upload')
    setPreview(null)
    setError(null)
    setExcelBlob(null)
    setExcelError(null)
    setPendingFingerprint(null)
    setPreviewIndex(null)
    setLastAddedSequence(null)
  }

  function viewQuotation(index: number) {
    setPreviewIndex(index)
    setStage('preview')
  }

  function closePreview() {
    setPreviewIndex(null)
    setStage('upload')
  }

  return (
    <main className="page">
      <h1>Quotation to Excel</h1>
      <p className="lead">
        Upload ERP quotation PDFs, check the extracted details, add each quotation to the session,
        then generate a consolidated Excel workbook.
      </p>

      {stage === 'upload' && (
        <UploadScreen
          pending={pending}
          pendingAction={pendingAction}
          error={error}
          onParse={readQuotation}
          onClearError={() => setError(null)}
          confirmedQuotations={confirmedQuotations}
          onViewQuotation={viewQuotation}
          onGenerateWorkbook={generateConsolidatedWorkbook}
          generationError={excelError}
          addedSequence={lastAddedSequence}
        />
      )}

      {stage === 'review' && preview && (
        <ReviewScreen
          key={draftId}
          initialPreview={preview}
          onConfirm={handleReviewConfirm}
          onCancel={cancelDraft}
          pending={pending}
          error={excelError}
        />
      )}

      {stage === 'review-with-sequence' && preview && (
        <ReviewScreen
          key={draftId}
          initialPreview={preview}
          onSequenceConfirm={handleSequenceConfirm}
          onBackToReview={() => setStage('review')}
          onCancel={cancelDraft}
          pending={pending}
          error={excelError}
          showSequenceInput
          usedSequenceNumbers={confirmedQuotations.map((cq) => cq.sequence_number)}
          sequenceNumber={nextSequenceNumber(confirmedQuotations)}
        />
      )}

      {stage === 'preview' && previewIndex !== null && confirmedQuotations[previewIndex] && (
        <ReviewScreen
          key={`preview-${previewIndex}`}
          initialPreview={toPreview(confirmedQuotations[previewIndex])}
          onClose={closePreview}
          readOnly
          sequenceNumber={confirmedQuotations[previewIndex].sequence_number}
        />
      )}

      {stage === 'completed' && (
        <CompletedScreen
          excelBlob={excelBlob}
          quotationCount={confirmedQuotations.length}
          totalLineItems={
            confirmedQuotations.reduce(
              (sum, cq) => sum + cq.quotation.items.length,
              0
            )
          }
          onStartAnother={startAnother}
          onResetSession={resetSession}
        />
      )}
    </main>
  )
}
