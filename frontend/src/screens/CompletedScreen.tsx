/**
 * Screen 4 — Completed.
 *
 * Shows the Excel download once generation succeeds. The workbook is generated
 * from the confirmed quotation data and returned as a blob for download.
 *
 * Three jobs end here, and they are not the same job: quotations alone, the
 * monitoring workbook alone, or both combined. The wording names the one that
 * happened, because this paragraph is the only confirmation the user gets that
 * the right file was made. A monitor-only export reported as "0 quotations
 * containing 0 line items combined into a single workbook" would be a sentence
 * about work that did not occur.
 */

import { useEffect, useRef, useState } from 'react'

type Props = {
  excelBlob: Blob | null
  quotationCount: number
  totalLineItems: number
  /**
   * Rows already in the workbook the user opened, as they were exported. Decides
   * whether this was a fresh workbook, a re-export of hers, or both.
   */
  existingRowCount?: number
  onStartAnother: () => void
  onResetSession: () => void
}

const DOWNLOAD_FILENAME = 'monitoring_sheet.xlsx'

export default function CompletedScreen({ 
  excelBlob, 
  quotationCount, 
  totalLineItems,
  existingRowCount = 0,
  onStartAnother,
  onResetSession 
}: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const confirmRef = useRef<HTMLHeadingElement>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const monitorOnly = quotationCount === 0 && existingRowCount > 0

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  // Opening the question puts focus on it, so the choice is announced and the
  // safe answer is the first thing reached from the keyboard.
  useEffect(() => {
    if (confirmingClear) confirmRef.current?.focus()
  }, [confirmingClear])

  function downloadExcel() {
    if (!excelBlob) return
    
    const url = URL.createObjectURL(excelBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = DOWNLOAD_FILENAME
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <section className="card">
      <h2 ref={headingRef} tabIndex={-1}>
        Excel file generated
      </h2>
      
      {excelBlob ? (
        <>
          {monitorOnly ? (
            <p>
              Your existing monitor has been exported with your saved changes. The workbook contains
              the same <strong>{existingRowCount}</strong> row
              {existingRowCount !== 1 ? 's' : ''}, in the same order, with the details you corrected.
            </p>
          ) : existingRowCount > 0 ? (
            <p>
              Your existing monitor and new quotations have been combined into one workbook. The{' '}
              <strong>{existingRowCount}</strong> row{existingRowCount !== 1 ? 's' : ''} already in
              the monitoring workbook come first, followed by{' '}
              <strong>{quotationCount}</strong> quotation{quotationCount !== 1 ? 's' : ''} containing{' '}
              <strong>{totalLineItems}</strong> line item{totalLineItems !== 1 ? 's' : ''}.
            </p>
          ) : (
            <p>
              Your quotation data has been converted to Excel format.
              <strong>{quotationCount}</strong> quotation{quotationCount !== 1 ? 's' : ''}
              containing <strong>{totalLineItems}</strong> line item{totalLineItems !== 1 ? 's' : ''}
              have been combined into a single workbook.
            </p>
          )}
          <p>
            Click below to download the consolidated workbook.
          </p>
          <button type="button" className="primary" onClick={downloadExcel}>
            Download Excel
          </button>
        </>
      ) : (
        <p>
          Excel generation failed. Please try again or contact support if the problem persists.
        </p>
      )}
      
      {confirmingClear ? (
        <div
          className="clear-confirm"
          role="group"
          aria-labelledby="clear-confirm-title"
          aria-describedby="clear-confirm-detail"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setConfirmingClear(false)
          }}
        >
          <h3 id="clear-confirm-title" ref={confirmRef} tabIndex={-1}>
            Clear all quotations?
          </h3>
          <p id="clear-confirm-detail" className="muted">
            This removes all <strong>{quotationCount}</strong> quotation
            {quotationCount !== 1 ? 's' : ''} ({totalLineItems} line item
            {totalLineItems !== 1 ? 's' : ''}) from this session. The workbook you have already
            downloaded is not affected. This action cannot be undone.
          </p>
          <div className="button-group">
            <button type="button" className="secondary" onClick={() => setConfirmingClear(false)}>
              Keep session
            </button>
            <button type="button" className="danger" onClick={onResetSession}>
              Clear session
            </button>
          </div>
        </div>
      ) : (
        <div className="button-group">
          <button type="button" onClick={onStartAnother}>
            Start another quotation
          </button>
          {/* Nothing to delete, so no action that implies there is. */}
          {quotationCount > 0 && (
            <button type="button" onClick={() => setConfirmingClear(true)}>
              Clear session
            </button>
          )}
        </div>
      )}
    </section>
  )
}
