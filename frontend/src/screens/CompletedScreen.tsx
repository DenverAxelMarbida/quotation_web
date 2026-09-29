/**
 * Screen 4 — Completed.
 *
 * Shows the Excel download once generation succeeds. The workbook is generated
 * from the confirmed quotation data and returned as a blob for download.
 */

import { useEffect, useRef, useState } from 'react'

type Props = {
  excelBlob: Blob | null
  quotationCount: number
  totalLineItems: number
  onStartAnother: () => void
  onResetSession: () => void
}

const DOWNLOAD_FILENAME = 'monitoring_sheet.xlsx'

export default function CompletedScreen({ 
  excelBlob, 
  quotationCount, 
  totalLineItems, 
  onStartAnother,
  onResetSession 
}: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const confirmRef = useRef<HTMLHeadingElement>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)

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
          <p>
            Your quotation data has been converted to Excel format. 
            <strong>{quotationCount}</strong> quotation{quotationCount !== 1 ? 's' : ''} 
            containing <strong>{totalLineItems}</strong> line item{totalLineItems !== 1 ? 's' : ''} 
            have been combined into a single workbook.
          </p>
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
