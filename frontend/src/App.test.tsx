/**
 * The whole quotation workflow, driven through the screen a user sees.
 *
 * Only the API module is mocked, so these tests exercise the real components,
 * the real draft reducer and the real error handling. The assertions describe
 * what a person would see and do, not the shape of internal state.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ApiError } from './api/client'
import { importMonitor } from './api/monitor'
import { generateConsolidatedExcel, generateExcel, parseQuotation } from './api/quotations'
import type { ImportedMonitor, ImportedMonitorRow } from './types/monitor'
import type { QuotationPreview } from './types/quotation'

vi.mock('./api/monitor', () => ({
  importMonitor: vi.fn(),
}))

vi.mock('./api/quotations', () => ({ 
  parseQuotation: vi.fn(),
  generateExcel: vi.fn(),
  generateConsolidatedExcel: vi.fn(),
}))

const monitorImport = vi.mocked(importMonitor)
const parse = vi.mocked(parseQuotation)
const genExcel = vi.mocked(generateExcel)
const genConsolidated = vi.mocked(generateConsolidatedExcel)

const PROJECT_FLAG =
  'This quotation does not print a project name. Please type it in.'
const QUANTITY_FLAG = 'Line 2: the quantity was not readable. Please type it in.'

/** A quotation whose project name was genuinely absent from the PDF. */
function alpagoPreview(): QuotationPreview {
  return {
    quotation: {
      quotation_number: 'QDXB/24/012489/Rev1',
      client_name: 'ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C',
      project_name: null,
      items: [
        { sr: '1', description: 'Vinyl flooring sheet 2mm', quantity: 200, unit: 'm2' },
        { sr: '2', description: 'Self-levelling compound', quantity: 200, unit: 'm2' },
      ],
    },
    review: [{ field: 'project_name', reason: 'missing', message: PROJECT_FLAG }],
    source: { filename: 'quotation3_ALPAGO - 012489REV1.pdf', page_count: 2, warnings: [] },
  }
}

/** A quotation that read cleanly except for one unreadable quantity. */
function referencePreview(quotationNumber = 'QDXB/25/014094/Rev1'): QuotationPreview {
  return {
    quotation: {
      quotation_number: quotationNumber,
      client_name: 'ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C',
      project_name: 'MBRC 466',
      items: [
        { sr: '1', description: 'Engineered Oak Flooring 15/4 x 120 x 600mm', quantity: 34, unit: 'm2' },
        { sr: '2', description: 'Engineered Oak Flooring 16/4 x 220 x RLmm', quantity: null, unit: 'm2' },
        { sr: '3', description: 'Self-levelling up to 3mm', quantity: 122, unit: 'm2' },
      ],
    },
    review: [{ field: 'items[1].quantity', reason: 'missing', message: QUANTITY_FLAG }],
    source: {
      filename: 'SAMPLE_VRP_Quotation - 2026-07-21T155726.357.pdf',
      page_count: 2,
      warnings: [],
    },
  }
}

/**
 * A quotation whose ERP numbers its lines hierarchically, two of them ending in
 * a zero. Read as numbers they would come back as 1.13 and 7.9.
 */
function hierarchicalPreview(): QuotationPreview {
  return {
    quotation: {
      quotation_number: 'QDXB/25/012375/Rev9',
      client_name: 'D B B CONTRACTING L.L.C.',
      project_name: 'Serenity Mansions - Tilal al ghaf',
      items: [
        { sr: '1.1', description: 'WF-01AR Engineered Walnut flooring', quantity: 5082, unit: 'm2' },
        { sr: '1.130', description: 'WF-03 AR Threshold', quantity: 2904, unit: 'm2' },
        { sr: '7.90', description: 'Skirting for WF-101 U', quantity: 3960, unit: 'L.M.' },
        { sr: '9.133', description: 'Self Levelling up to 2-3mm', quantity: 31547, unit: 'm2' },
      ],
    },
    review: [],
    source: { filename: 'borderless-quotation.pdf', page_count: 8, warnings: [] },
  }
}

/** A quotation whose ERP quotation number was absent from the PDF. */
function noNumberPreview(): QuotationPreview {
  const preview = referencePreview()
  preview.quotation.quotation_number = null
  return preview
}

let fileCounter = 0

/**
 * A PDF file. Each call gets distinct content so two uploads are treated as two
 * different documents; pass `content` explicitly to model the very same file.
 */
function pdfFile(name = 'quote.pdf', content?: string): File {
  return new File([content ?? `${name}::${fileCounter++}`], name, {
    type: 'application/pdf',
  })
}

/** Selects a file and asks for it to be read. */
function chooseAndRead(file: File) {
  fireEvent.change(screen.getByLabelText('Quotation PDF file'), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: 'Read quotation' }))
}

function reviewScreen() {
  // The heading text changes based on whether we're in sequence input mode
  // Use the h2 (main heading) to avoid duplicate h3 matches
  return screen.findByRole('heading', { 
    name: /check the quotation details|assign sequence number/i,
    level: 2
  })
}

/** Waits for the automatic sequence step. */
function sequenceScreen() {
  return screen.findByRole('heading', { name: /assign sequence number/i, level: 2 })
}

beforeEach(() => {
  parse.mockReset()
  genExcel.mockReset()
  genConsolidated.mockReset()
  monitorImport.mockReset()
  // By default, generateExcel returns a mock blob
  genExcel.mockResolvedValue(new Blob(['mock excel data'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  genConsolidated.mockResolvedValue(new Blob(['mock excel data'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
})

describe('upload screen', () => {
  it('offers a PDF upload and an action to read it', () => {
    render(<App />)

    expect(screen.getByLabelText('Quotation PDF file')).toHaveAttribute('accept', 'application/pdf,.pdf')
    expect(screen.getByRole('button', { name: 'Read quotation' })).toBeInTheDocument()
  })

  it('shows the name of the file that was selected', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText('Quotation PDF file'), {
      target: { files: [pdfFile('quotation2_Tee Vee - 004050Rev2.pdf')] },
    })

    expect(screen.getByText('quotation2_Tee Vee - 004050Rev2.pdf')).toBeInTheDocument()
  })

  it('rejects a file that is not a PDF without calling the backend', async () => {
    render(<App />)

    chooseAndRead(new File(['hello'], 'notes.txt', { type: 'text/plain' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/pdf/i)
    expect(parse).not.toHaveBeenCalled()
  })

  it('shows a clear processing state and refuses a second submission', async () => {
    let release: (value: QuotationPreview) => void = () => {}
    parse.mockImplementationOnce(
      () => new Promise<QuotationPreview>((resolve) => (release = resolve)),
    )
    render(<App />)

    chooseAndRead(pdfFile())
    expect(await screen.findByRole('status')).toHaveTextContent(/reading the quotation/i)

    const button = screen.getByRole('button', { name: 'Read quotation' })
    expect(button).toBeDisabled()
    fireEvent.click(button)

    await waitFor(() => expect(parse).toHaveBeenCalledTimes(1))
    release(referencePreview())
    await reviewScreen()
  })

  it('shows the backend message when the file cannot be read', async () => {
    parse.mockRejectedValueOnce(
      new ApiError(
        'This file could not be read as a quotation PDF.',
        415,
        'UnsupportedDocumentError',
        'Upload the original quotation PDF exported from the ERP.',
      ),
    )
    render(<App />)

    chooseAndRead(pdfFile('damaged.pdf'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('This file could not be read as a quotation PDF.')
    expect(alert).toHaveTextContent('Upload the original quotation PDF exported from the ERP.')
    expect(screen.queryByLabelText('Client name')).not.toBeInTheDocument()
  })

  it('does not leave an earlier quotation on screen after a later failure', async () => {
    parse.mockResolvedValueOnce(referencePreview())
    const { unmount } = render(<App />)
    chooseAndRead(pdfFile())
    await reviewScreen()
    unmount()

    parse.mockRejectedValueOnce(new ApiError('No text could be read from this PDF.', 422, 'E', null))
    render(<App />)

    chooseAndRead(pdfFile('scanned.pdf'))

    await screen.findByRole('alert')
    expect(screen.queryByLabelText('Client name')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Read quotation' })).toBeEnabled()
  })
})

describe('review screen', () => {
  it('shows the quotation details that were read from the PDF', async () => {
    parse.mockResolvedValueOnce(referencePreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()

    expect(screen.getByLabelText('Quotation number')).toHaveValue('QDXB/25/014094/Rev1')
    expect(screen.getByLabelText('Client name')).toHaveValue(
      'ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C',
    )
    expect(screen.getByLabelText('Project name')).toHaveValue('MBRC 466')
  })

  it('shows every line item as its own row', async () => {
    parse.mockResolvedValueOnce(referencePreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()

    expect(screen.getByLabelText('Line 1 description')).toHaveValue(
      'Engineered Oak Flooring 15/4 x 120 x 600mm',
    )
    expect(screen.getByLabelText('Line 1 quantity')).toHaveValue(34)
    expect(screen.getByLabelText('Line 1 unit')).toHaveValue('m2')
    expect(screen.getByLabelText('Line 3 description')).toHaveValue('Self-levelling up to 3mm')
    expect(screen.getByLabelText('Line 3 quantity')).toHaveValue(122)
  })

  it('marks the fields the parser could not read', async () => {
    parse.mockResolvedValueOnce(referencePreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()

    const quantity = screen.getByLabelText('Line 2 quantity')
    expect(quantity).toHaveAccessibleDescription(QUANTITY_FLAG)
    expect(quantity).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0)
  })

  it('summarises how many fields are still waiting to be checked', async () => {
    parse.mockResolvedValueOnce(referencePreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()

    expect(screen.getByText('Review required')).toBeInTheDocument()
  })

  it('lets a project name that the PDF never printed be typed in', async () => {
    parse.mockResolvedValueOnce(alpagoPreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()

    const projectName = screen.getByLabelText('Project name')
    expect(projectName).toHaveValue('')
    expect(projectName).toHaveAccessibleDescription(PROJECT_FLAG)

    fireEvent.change(projectName, { target: { value: 'Marina Bay Tower' } })

    expect(screen.getByLabelText('Project name')).toHaveValue('Marina Bay Tower')
    expect(screen.queryByText(PROJECT_FLAG)).not.toBeInTheDocument()
    expect(screen.queryByText('Review required')).not.toBeInTheDocument()
  })

  it('lets a value that read correctly be corrected', async () => {
    parse.mockResolvedValueOnce(referencePreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()

    const clientName = screen.getByLabelText('Client name')
    fireEvent.change(clientName, { target: { value: 'Alpago Design LLC' } })

    expect(screen.getByLabelText('Client name')).toHaveValue('Alpago Design LLC')
    // The unrelated flag must survive: correcting one field is not a review pass.
    expect(screen.getByText(QUANTITY_FLAG)).toBeInTheDocument()
  })

  it('keeps an unreadable quantity empty rather than guessing a number', async () => {
    parse.mockResolvedValueOnce(referencePreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()

    fireEvent.change(screen.getByLabelText('Line 2 quantity'), { target: { value: 'not a number' } })

    expect(screen.getByLabelText('Line 2 quantity')).toHaveValue(null)
  })

  it('still marks a quantity that is left empty', async () => {
    parse.mockResolvedValueOnce(referencePreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()

    const quantity = screen.getByLabelText('Line 2 quantity')
    expect(quantity).toHaveAccessibleDescription(QUANTITY_FLAG)

    fireEvent.change(quantity, { target: { value: '' } })

    // The person emptied the box. That supplies nothing, so the field must keep
    // saying it needs review rather than going quietly blank.
    expect(screen.getByLabelText('Line 2 quantity')).toHaveAccessibleDescription(QUANTITY_FLAG)
    expect(screen.getByText('Review required')).toBeInTheDocument()
  })

  it('still marks a project name that is left empty', async () => {
    parse.mockResolvedValueOnce(alpagoPreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: '   ' } })

    expect(screen.getByLabelText('Project name')).toHaveValue('')
    expect(screen.getByLabelText('Project name')).toHaveAccessibleDescription(PROJECT_FLAG)
  })

  it('brings a flag back when a typed project name is withdrawn', async () => {
    parse.mockResolvedValueOnce(alpagoPreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()

    const projectName = screen.getByLabelText('Project name')
    fireEvent.change(projectName, { target: { value: 'Marina Bay Tower' } })
    expect(screen.queryByText(PROJECT_FLAG)).not.toBeInTheDocument()
    expect(screen.getByText('Ready for review')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: '' } })

    // The field is blank again, so the form must stop claiming it is clean.
    expect(screen.getByLabelText('Project name')).toHaveAccessibleDescription(PROJECT_FLAG)
    expect(screen.getByText('Review required')).toBeInTheDocument()
    expect(screen.queryByText('Ready for review')).not.toBeInTheDocument()
  })

  it('adds a blank line item that can be filled in', async () => {
    parse.mockResolvedValueOnce(referencePreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()

    fireEvent.click(screen.getByRole('button', { name: 'Add line item' }))

    expect(screen.getByLabelText('Line 4 description')).toHaveValue('')
    expect(screen.getByLabelText('Line 4 quantity')).toHaveValue(null)
  })

  it('asks before deleting a line item', async () => {
    parse.mockResolvedValueOnce(referencePreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()

    fireEvent.click(screen.getByRole('button', { name: 'Delete line 1' }))

    expect(screen.getByLabelText('Line 1 description')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm delete line 1' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete line 1' }))

    expect(screen.getAllByLabelText(/^Line \d+ description$/)).toHaveLength(2)
    expect(screen.getByLabelText('Line 1 description')).toHaveValue(
      'Engineered Oak Flooring 16/4 x 220 x RLmm',
    )
    expect(screen.getByLabelText('Line 2 description')).toHaveValue('Self-levelling up to 3mm')
  })

  it('moves a review flag onto the right row when an earlier item is deleted', async () => {
    parse.mockResolvedValueOnce(referencePreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()

    expect(screen.getByLabelText('Line 2 quantity')).toHaveAccessibleDescription(QUANTITY_FLAG)

    fireEvent.click(screen.getByRole('button', { name: 'Delete line 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete line 1' }))

    // The flagged row is now the first row, and the flag followed the data.
    const firstRow = screen.getByLabelText('Line 1 quantity').closest('tr')
    expect(firstRow).not.toBeNull()
    expect(within(firstRow as HTMLElement).getByDisplayValue(/16\/4 x 220/)).toBeInTheDocument()
    expect(screen.getByLabelText('Line 1 quantity')).toHaveAccessibleDescription(QUANTITY_FLAG)
    expect(screen.getByLabelText('Line 2 quantity')).not.toHaveAttribute('aria-invalid')
  })

  it('keeps the fields it is not allowed to infer out of the form', async () => {
    parse.mockResolvedValueOnce(referencePreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()

    for (const forbidden of ['Sequence number', 'Installation schedule', 'Start date', 'Status']) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument()
    }
  })
})

describe('confirming and adding to workbook', () => {
  it('confirms a quotation and moves to sequence number input', async () => {
    parse.mockResolvedValueOnce(alpagoPreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()

    // A quotation with no project name must still be finishable, so the button
    // is offered with a notice rather than withheld.
    expect(screen.getByRole('button', { name: 'Confirm quotation' })).toBeEnabled()
    expect(screen.getByText(/you can confirm with fields still marked/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))

    // Should move to automatic sequence assignment screen
    expect(await screen.findByRole('heading', { name: /assign sequence number/i, level: 2 })).toBeInTheDocument()
    expect(screen.getByLabelText('Sequence Number')).toBeInTheDocument()
  })

  it('adds the quotation to the workbook with its automatic sequence number', async () => {
    parse.mockResolvedValueOnce(referencePreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))

    // The next number is shown ready to use and can be added straight away.
    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))

    // Should return to upload screen with the quotation count
    await screen.findByLabelText('Quotation PDF file')
    expect(screen.getByText(/1 quotation/)).toBeInTheDocument()
  })

  it('offers the first sequence number automatically without typing', async () => {
    parse.mockResolvedValueOnce(referencePreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()

    // 001 is offered, and no manual input is required to proceed.
    expect(screen.getByLabelText('Sequence Number')).toHaveTextContent('001')
    expect(screen.getByRole('button', { name: 'Add to Workbook' })).toBeEnabled()
  })

  it('keeps the quotation in the session after adding', async () => {
    parse.mockResolvedValueOnce(alpagoPreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))

    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))

    // Session feedback on the upload screen.
    await screen.findByLabelText('Quotation PDF file')
    expect(screen.getByText(/1 quotation/)).toBeInTheDocument()
    expect(screen.getByText(/2 line item/)).toBeInTheDocument()

    // The sequence number is stored as a zero-padded string.
    genConsolidated.mockResolvedValueOnce(new Blob(['mock']))
    fireEvent.click(screen.getByRole('button', { name: /generate consolidated workbook/i }))
    await waitFor(() => expect(genConsolidated).toHaveBeenCalledTimes(1))
    expect(genConsolidated.mock.calls[0][0].quotations[0].sequence_number).toBe('001')
  })

  it('going back to review keeps the quotation editable and adds nothing yet', async () => {
    parse.mockResolvedValueOnce(referencePreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))

    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Review' }))

    // Back on the review screen, still editable, and nothing was added.
    await screen.findByRole('heading', { name: 'Check the quotation details', level: 2 })
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'MBRC 466' } })

    // No session summary yet, because no quotation has been confirmed.
    expect(screen.queryByText(/1 quotation/)).not.toBeInTheDocument()
  })

  it('editing a later quotation does not change an already confirmed one', async () => {
    // First quotation is confirmed and must survive untouched.
    parse.mockResolvedValueOnce(referencePreview())
    render(<App />)
    chooseAndRead(pdfFile())
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')

    // Second quotation is edited after the first was confirmed.
    parse.mockResolvedValueOnce(alpagoPreview())
    chooseAndRead(pdfFile())
    await reviewScreen()
    fireEvent.change(screen.getByLabelText('Client name'), { target: { value: 'CHANGED CLIENT' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')

    genConsolidated.mockResolvedValueOnce(new Blob(['mock']))
    fireEvent.click(screen.getByRole('button', { name: /generate consolidated workbook/i }))
    await waitFor(() => expect(genConsolidated).toHaveBeenCalledTimes(1))

    const { quotations } = genConsolidated.mock.calls[0][0]
    expect(quotations[0].sequence_number).toBe('001')
    expect(quotations[0].quotation.client_name).toBe(
      'ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C',
    )
    expect(quotations[1].sequence_number).toBe('002')
    expect(quotations[1].quotation.client_name).toBe('CHANGED CLIENT')
  })

  it('can add multiple quotations and generate consolidated workbook', async () => {
    // First quotation
    parse.mockResolvedValueOnce(referencePreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))

    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))

    // Should return to upload screen
    await screen.findByLabelText('Quotation PDF file')
    expect(screen.getByText(/1 quotation/)).toBeInTheDocument()

    // Second quotation — same client, different ERP quotation number.
    parse.mockResolvedValueOnce(referencePreview('QDXB/25/014095/Rev1'))
    chooseAndRead(pdfFile())
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))

    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))

    // Should return to upload screen with 2 quotations
    await screen.findByLabelText('Quotation PDF file')
    expect(screen.getByText(/2 quotations/)).toBeInTheDocument()

    // Generate consolidated workbook
    genConsolidated.mockResolvedValueOnce(
      new Blob(['mock excel data'], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    )

    fireEvent.click(screen.getByRole('button', { name: /generate consolidated workbook/i }))

    // The request must carry both quotations, in the order they were added, with
    // the sequence numbers the app assigned.
    await waitFor(() => expect(genConsolidated).toHaveBeenCalledTimes(1))
    const request = genConsolidated.mock.calls[0][0]
    expect(request.quotations.map((q) => q.sequence_number)).toEqual(['001', '002'])
    expect(request.quotations.map((q) => q.quotation.items.length)).toEqual([3, 3])

    // Should show completed screen
    await screen.findByRole('heading', { name: /excel file generated/i })
    // Check in the completed screen section - get the section containing the heading
    const completedHeading = screen.getByRole('heading', { name: /excel file generated/i })
    const completedSection = completedHeading.closest('section')
    expect(completedSection).toBeInTheDocument()
    // The text is split across elements, so just verify the section contains the info
    expect(completedSection).toHaveTextContent(/2 quotation/)
    expect(completedSection).toHaveTextContent(/6 line item/)
  })

  it('starts each upload with a clean copy of the previous draft', async () => {
    parse.mockResolvedValueOnce(referencePreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'MBRC 466' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))

    // Add to workbook with the automatic sequence number
    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))

    // Back to upload screen
    await screen.findByLabelText('Quotation PDF file')

    // Upload second quotation (a different ERP quotation number).
    parse.mockResolvedValueOnce(referencePreview('QDXB/25/014095/Rev1'))
    chooseAndRead(pdfFile())

    await reviewScreen()
    // The flag is back, which it would not be if the old draft had been reused.
    await waitFor(() =>
      expect(screen.getByText('Review required')).toBeInTheDocument(),
    )
    expect(screen.getByLabelText('Line 2 quantity')).toHaveAccessibleDescription(QUANTITY_FLAG)
  })

  it('can go back from sequence input to review', async () => {
    parse.mockResolvedValueOnce(referencePreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))

    // Should be in sequence assignment mode
    await sequenceScreen()

    // Click back to review
    fireEvent.click(screen.getByRole('button', { name: 'Back to Review' }))

    // Should be back in review mode
    expect(await screen.findByRole('heading', { name: /check the quotation details/i, level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm quotation' })).toBeInTheDocument()
  })
})

describe('session continuation and reset', () => {
  /** Drives one quotation all the way to confirmed with its automatic number. */
  async function addQuotation(preview: QuotationPreview) {
    parse.mockResolvedValueOnce(preview)
    chooseAndRead(pdfFile())
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')
  }

  /** Generates the consolidated workbook and waits for the completed screen. */
  async function generateWorkbook() {
    genConsolidated.mockResolvedValueOnce(new Blob(['mock']))
    fireEvent.click(screen.getByRole('button', { name: /generate consolidated workbook/i }))
    await screen.findByRole('heading', { name: /excel file generated/i })
  }

  it('keeps confirmed quotations when starting another quotation', async () => {
    render(<App />)
    await addQuotation(referencePreview())
    expect(screen.getByText(/1 quotation/)).toBeInTheDocument()

    await generateWorkbook()

    fireEvent.click(screen.getByRole('button', { name: 'Start another quotation' }))

    // Back at the upload/start stage, with the session still intact.
    expect(await screen.findByLabelText('Quotation PDF file')).toBeInTheDocument()
    expect(screen.getByText(/1 quotation/)).toBeInTheDocument()
    expect(screen.getByText(/3 line item/)).toBeInTheDocument()
    // The working draft is reset: no review form is left on screen.
    expect(screen.queryByLabelText('Client name')).not.toBeInTheDocument()
  })

  it('adds a later quotation to the preserved session and sends them all', async () => {
    render(<App />)
    await addQuotation(referencePreview())

    await generateWorkbook()
    fireEvent.click(screen.getByRole('button', { name: 'Start another quotation' }))
    await screen.findByLabelText('Quotation PDF file')

    await addQuotation(alpagoPreview())
    expect(screen.getByText(/2 quotations/)).toBeInTheDocument()

    await generateWorkbook()

    // The second request must carry both quotations, not only the new one.
    expect(genConsolidated).toHaveBeenCalledTimes(2)
    const request = genConsolidated.mock.calls[1][0]
    expect(request.quotations.map((q) => q.sequence_number)).toEqual(['001', '002'])
    expect(request.quotations.map((q) => q.quotation.items.length)).toEqual([3, 2])
  })

  it('clears the whole session when Clear session is confirmed', async () => {
    render(<App />)
    await addQuotation(referencePreview())
    await generateWorkbook()

    // One click asks the question; the second one accepts it.
    fireEvent.click(screen.getByRole('button', { name: 'Clear session' }))
    expect(screen.getByText(/clear all quotations\?/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear session' }))

    // A completely fresh session: initial upload state, nothing confirmed.
    expect(await screen.findByLabelText('Quotation PDF file')).toBeInTheDocument()
    expect(screen.queryByText(/quotation ready for Excel/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /generate consolidated workbook/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Client name')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sequence Number')).not.toBeInTheDocument()
  })

  it('continues automatic sequence numbering after starting another quotation', async () => {
    render(<App />)
    await addQuotation(referencePreview())

    await generateWorkbook()
    fireEvent.click(screen.getByRole('button', { name: 'Start another quotation' }))
    await screen.findByLabelText('Quotation PDF file')

    // Begin a new quotation and stop at the sequence step.
    parse.mockResolvedValueOnce(alpagoPreview())
    chooseAndRead(pdfFile())
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()

    // The next number is derived from the confirmed session, not retyped.
    expect(screen.getByLabelText('Sequence Number')).toHaveTextContent('002')
    expect(screen.getByRole('button', { name: 'Add to Workbook' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')
    expect(screen.getByText(/2 quotations/)).toBeInTheDocument()
  })
})

describe('session quotations and duplicate protection', () => {
  /** Adds one quotation by driving the whole journey with a specific file. */
  async function addQuotation(preview: QuotationPreview, file: File) {
    parse.mockResolvedValueOnce(preview)
    chooseAndRead(file)
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')
  }

  it('lists every confirmed quotation with its sequence and item count', async () => {
    render(<App />)
    await addQuotation(referencePreview(), pdfFile('first.pdf'))

    const table = screen.getByRole('table', { name: /quotations already added/i })
    const row = within(table).getByRole('row', { name: /001/ })
    expect(within(row).getByText('QDXB/25/014094/Rev1')).toBeInTheDocument()
    expect(within(row).getByText('MBRC 466')).toBeInTheDocument()
    expect(within(row).getByText('3')).toBeInTheDocument()
    expect(
      within(row).getByRole('button', { name: /view details for sequence 001/i }),
    ).toBeInTheDocument()
  })

  it('opens a read-only preview without changing the session', async () => {
    render(<App />)
    await addQuotation(referencePreview(), pdfFile('first.pdf'))

    fireEvent.click(screen.getByRole('button', { name: /view details for sequence 001/i }))

    expect(
      await screen.findByRole('heading', { name: 'Quotation preview', level: 2 }),
    ).toBeInTheDocument()
    expect(screen.getByDisplayValue('MBRC 466')).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    await screen.findByLabelText('Quotation PDF file')
    expect(screen.getByText(/1 quotation/)).toBeInTheDocument()
  })

  it('shows which sequence numbers are already used', async () => {
    render(<App />)
    await addQuotation(referencePreview(), pdfFile('first.pdf'))

    parse.mockResolvedValueOnce(alpagoPreview())
    chooseAndRead(pdfFile('second.pdf'))
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()

    expect(screen.getByText(/already used: 001/i)).toBeInTheDocument()
  })

  it('never offers a sequence number that is already assigned', async () => {
    render(<App />)
    await addQuotation(referencePreview(), pdfFile('first.pdf'))

    parse.mockResolvedValueOnce(alpagoPreview())
    chooseAndRead(pdfFile('second.pdf'))
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()

    // The offered number is past every confirmed one, and adding just works.
    const offered = screen.getByLabelText('Sequence Number')
    expect(offered).toHaveTextContent('002')
    expect(screen.queryByText(/already assigned/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to Workbook' })).toBeEnabled()
  })

  it('refuses the exact same PDF twice', async () => {
    render(<App />)
    const bytes = '%PDF-1.4 the same bytes'
    await addQuotation(referencePreview(), pdfFile('first.pdf', bytes))

    // Same content, even under another name, is the same document.
    chooseAndRead(pdfFile('renamed.pdf', bytes))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/already been added to this session/i)
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it('refuses a second file with the same ERP quotation number', async () => {
    render(<App />)
    await addQuotation(referencePreview(), pdfFile('first.pdf', 'first bytes'))

    parse.mockResolvedValueOnce(referencePreview())
    chooseAndRead(pdfFile('second.pdf', 'second bytes'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Quotation QDXB/25/014094/Rev1 has already been added to this session.',
    )
    expect(screen.queryByLabelText('Sequence Number')).not.toBeInTheDocument()
  })

  it('allows a different quotation for the same client', async () => {
    render(<App />)
    await addQuotation(referencePreview(), pdfFile('first.pdf', 'first bytes'))

    parse.mockResolvedValueOnce(referencePreview('QDXB/25/014096/Rev1'))
    chooseAndRead(pdfFile('second.pdf', 'second bytes'))

    await reviewScreen()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('allows a quotation with no ERP quotation number', async () => {
    render(<App />)
    await addQuotation(noNumberPreview(), pdfFile('first.pdf', 'first bytes'))

    parse.mockResolvedValueOnce(noNumberPreview())
    chooseAndRead(pdfFile('second.pdf', 'second bytes'))

    await reviewScreen()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('state communication', () => {
  /** Adds one quotation by driving the whole journey with a specific file. */
  async function addQuotation(preview: QuotationPreview, file: File) {
    parse.mockResolvedValueOnce(preview)
    chooseAndRead(file)
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')
  }

  it('says what is happening while the Excel workbook is generated', async () => {
    render(<App />)
    await addQuotation(referencePreview(), pdfFile('first.pdf'))

    let release: (blob: Blob) => void = () => {}
    genConsolidated.mockImplementationOnce(
      () => new Promise<Blob>((resolve) => (release = resolve)),
    )

    fireEvent.click(screen.getByRole('button', { name: /generate consolidated workbook/i }))

    // Generating is not the same as reading the PDF, so the wording must differ.
    expect(await screen.findByText(/generating the excel workbook/i)).toBeInTheDocument()
    expect(screen.queryByText(/reading the quotation/i)).not.toBeInTheDocument()

    release(new Blob(['mock']))
    await screen.findByRole('heading', { name: /excel file generated/i })
  })

  it('shows a clear error when the Excel workbook cannot be generated', async () => {
    render(<App />)
    await addQuotation(referencePreview(), pdfFile('first.pdf'))

    genConsolidated.mockRejectedValueOnce(new Error('The workbook could not be generated.'))
    fireEvent.click(screen.getByRole('button', { name: /generate consolidated workbook/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/excel generation failed/i)
    expect(alert).toHaveTextContent(/try again/i)

    // The failure is shown in place; the session and its data are not lost.
    expect(screen.getByLabelText('Quotation PDF file')).toBeInTheDocument()
    expect(screen.getByText(/1 quotation ready for Excel/i)).toBeInTheDocument()
  })

  it('presents the session summary as a positive state, not an error', async () => {
    render(<App />)
    await addQuotation(referencePreview(), pdfFile('first.pdf'))

    const summary = screen.getByText(/1 quotation ready for Excel/i)
    expect(summary.closest('.notice')).toHaveClass('notice--success')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the automatic sequence number as a read-only value, not a blank field', async () => {
    render(<App />)
    await addQuotation(referencePreview(), pdfFile('first.pdf'))

    parse.mockResolvedValueOnce(alpagoPreview())
    chooseAndRead(pdfFile('second.pdf'))
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()

    // The number is stated outright, so it needs no colour or tag to be understood.
    const sequence = screen.getByLabelText('Sequence Number')
    expect(sequence).toHaveTextContent('002')
    expect(sequence.tagName).toBe('OUTPUT')
    expect(screen.queryByRole('textbox', { name: 'Sequence Number' })).not.toBeInTheDocument()
    expect(screen.queryByText('Required')).not.toBeInTheDocument()
  })

  it('styles the empty line-item state intentionally', async () => {
    const empty = referencePreview()
    empty.quotation.items = []
    empty.review = []

    parse.mockResolvedValueOnce(empty)
    render(<App />)
    chooseAndRead(pdfFile('empty.pdf'))
    await reviewScreen()

    expect(screen.getByText(/no line items were read from this PDF/i)).toHaveClass('empty-state')
  })
})

describe('automatic sequence assignment and cancelling a draft', () => {
  /** Adds one quotation with its automatic number, optionally under a chosen name. */
  async function addQuotation(preview: QuotationPreview, name = 'quotation.pdf') {
    parse.mockResolvedValueOnce(preview)
    chooseAndRead(pdfFile(name))
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')
  }

  /** Opens a draft and stops on the automatic sequence step. */
  async function startDraft(preview: QuotationPreview, name: string) {
    parse.mockResolvedValueOnce(preview)
    chooseAndRead(pdfFile(name))
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()
  }

  it('numbers quotations in order without any typing', async () => {
    render(<App />)

    await startDraft(referencePreview(), 'first.pdf')
    expect(screen.getByLabelText('Sequence Number')).toHaveTextContent('001')
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')

    await startDraft(referencePreview('QDXB/25/014095/Rev1'), 'second.pdf')
    expect(screen.getByLabelText('Sequence Number')).toHaveTextContent('002')
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')

    await startDraft(referencePreview('QDXB/25/014096/Rev1'), 'third.pdf')
    expect(screen.getByLabelText('Sequence Number')).toHaveTextContent('003')
  })

  it('consumes a number only when the quotation is actually added', async () => {
    render(<App />)
    await addQuotation(referencePreview(), 'first.pdf')
    await addQuotation(referencePreview('QDXB/25/014095/Rev1'), 'second.pdf')

    // The third number is offered, but the draft is cancelled instead of added.
    await startDraft(alpagoPreview(), 'third.pdf')
    expect(screen.getByLabelText('Sequence Number')).toHaveTextContent('003')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await screen.findByLabelText('Quotation PDF file')

    // 003 was never used, so the next quotation still gets 003.
    await startDraft(referencePreview('QDXB/25/014096/Rev1'), 'fourth.pdf')
    expect(screen.getByLabelText('Sequence Number')).toHaveTextContent('003')
  })

  it('cancels the draft without touching the confirmed session', async () => {
    render(<App />)
    await addQuotation(referencePreview(), 'first.pdf')

    parse.mockResolvedValueOnce(alpagoPreview())
    chooseAndRead(pdfFile('second.pdf'))
    await reviewScreen()
    fireEvent.change(screen.getByLabelText('Client name'), {
      target: { value: 'A CLIENT THAT MUST BE DISCARDED' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    // Back at the start, with the confirmed quotation untouched...
    await screen.findByLabelText('Quotation PDF file')
    expect(screen.getByText(/1 quotation ready for Excel/i)).toBeInTheDocument()
    expect(screen.getByText(/3 line item/i)).toBeInTheDocument()
    expect(genConsolidated).not.toHaveBeenCalled()

    // ...and with no part of the cancelled draft left on screen.
    expect(screen.queryByLabelText('Client name')).not.toBeInTheDocument()
    expect(screen.queryByText('A CLIENT THAT MUST BE DISCARDED')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to Workbook' })).not.toBeInTheDocument()
  })

  it('cancels a draft that was never added and leaves the session untouched', async () => {
    render(<App />)

    parse.mockResolvedValueOnce(alpagoPreview())
    chooseAndRead(pdfFile('first.pdf'))
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await screen.findByLabelText('Quotation PDF file')
    expect(screen.queryByText(/quotation ready for Excel/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Client name')).not.toBeInTheDocument()
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it('gives every line item of one quotation the same sequence number', async () => {
    render(<App />)
    await addQuotation(referencePreview(), 'first.pdf')

    genConsolidated.mockResolvedValueOnce(new Blob(['mock']))
    fireEvent.click(screen.getByRole('button', { name: /generate consolidated workbook/i }))
    await waitFor(() => expect(genConsolidated).toHaveBeenCalledTimes(1))

    // One quotation, one sequence number, shared by all of its line items.
    const request = genConsolidated.mock.calls[0][0]
    expect(request.quotations).toHaveLength(1)
    expect(request.quotations[0].quotation.items).toHaveLength(3)
    expect(request.quotations[0].sequence_number).toBe('001')
  })
})

describe('table readability', () => {
  it('labels the session action column and aligns the narrow columns', async () => {
    render(<App />)

    parse.mockResolvedValueOnce(referencePreview())
    chooseAndRead(pdfFile('first.pdf'))
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')

    const table = screen.getByRole('table', { name: /quotations already added/i })
    expect(within(table).getByRole('columnheader', { name: 'Action' })).toHaveClass('align-center')
    expect(within(table).getByRole('columnheader', { name: 'Seq.' })).toHaveClass('align-center')
    expect(within(table).getByRole('columnheader', { name: 'Items' })).toHaveClass('align-center')
    expect(within(table).getByRole('columnheader', { name: 'Client' })).not.toHaveClass(
      'align-center',
    )

    // The action button sits in that column on the quotation's own row.
    const row = within(table).getByRole('row', { name: /001/ })
    const view = within(row).getByRole('button', { name: /view details for sequence 001/i })
    expect(view.closest('td')).toHaveClass('align-center')
  })

  it('labels the line-item action column and aligns quantity and unit', async () => {
    render(<App />)

    parse.mockResolvedValueOnce(referencePreview())
    chooseAndRead(pdfFile('first.pdf'))
    await reviewScreen()

    const table = screen.getByRole('table', { name: /line items read from the quotation/i })
    expect(within(table).getByRole('columnheader', { name: 'Action' })).toHaveClass('align-center')
    expect(within(table).getByRole('columnheader', { name: 'SR#' })).toHaveClass('align-center')
    expect(within(table).getByRole('columnheader', { name: 'Quantity' })).toHaveClass('align-right')
    expect(within(table).getByRole('columnheader', { name: 'Unit' })).toHaveClass('align-center')
    expect(within(table).getByRole('columnheader', { name: 'Description' })).not.toHaveClass(
      'align-right',
    )
  })

  it('keeps each delete action on the row it belongs to', async () => {
    render(<App />)

    parse.mockResolvedValueOnce(referencePreview())
    chooseAndRead(pdfFile('first.pdf'))
    await reviewScreen()

    const table = screen.getByRole('table', { name: /line items read from the quotation/i })
    const rows = within(table).getAllByRole('row')
    // One header row plus one row per line item.
    expect(rows).toHaveLength(4)

    // The delete button for line 2 lives in line 2's own row, and nowhere else.
    const second = screen.getByLabelText('Line 2 description').closest('tr') as HTMLElement
    expect(within(second).getByRole('button', { name: 'Delete line 2' })).toBeInTheDocument()
    expect(within(rows[1]).getByRole('button', { name: 'Delete line 1' })).toBeInTheDocument()
    expect(within(rows[1]).queryByRole('button', { name: 'Delete line 2' })).not.toBeInTheDocument()
  })
})


describe('clearing the session', () => {
  /** Adds one quotation, generates the workbook, and lands on the completed screen. */
  async function addAndGenerate(preview: QuotationPreview, name = 'first.pdf') {
    parse.mockResolvedValueOnce(preview)
    chooseAndRead(pdfFile(name))
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')

    genConsolidated.mockResolvedValueOnce(new Blob(['mock']))
    fireEvent.click(screen.getByRole('button', { name: /generate consolidated workbook/i }))
    await screen.findByRole('heading', { name: /excel file generated/i })
  }

  it('asks before removing anything', async () => {
    render(<App />)
    await addAndGenerate(referencePreview())

    fireEvent.click(screen.getByRole('button', { name: 'Clear session' }))

    // A question is asked, and nothing has been removed yet.
    expect(screen.getByText(/clear all quotations\?/i)).toBeInTheDocument()
    expect(screen.getByText(/this action cannot be undone/i)).toBeInTheDocument()
    // The completed screen is still showing the session it had.
    expect(screen.getByRole('heading', { name: /excel file generated/i })).toBeInTheDocument()
    expect(genConsolidated).toHaveBeenCalledTimes(1)
  })

  it('says exactly what will be deleted', async () => {
    render(<App />)
    await addAndGenerate(referencePreview())

    fireEvent.click(screen.getByRole('button', { name: 'Clear session' }))

    const question = screen
      .getByText(/clear all quotations\?/i)
      .closest('[role="group"]') as HTMLElement
    expect(question).toHaveTextContent('1 quotation')
    expect(question).toHaveTextContent('3 line items')
  })

  it('keeps every quotation when the confirmation is declined', async () => {
    render(<App />)
    await addAndGenerate(referencePreview())

    fireEvent.click(screen.getByRole('button', { name: 'Clear session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep session' }))

    // The question is gone and the completed screen is back to normal.
    expect(screen.queryByText(/clear all quotations\?/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download excel/i })).toBeInTheDocument()

    // The quotation is still in the session.
    fireEvent.click(screen.getByRole('button', { name: 'Start another quotation' }))
    await screen.findByLabelText('Quotation PDF file')
    const table = screen.getByRole('table', { name: /quotations already added/i })
    expect(within(table).getByRole('row', { name: /001/ })).toBeInTheDocument()
  })

  it('removes every quotation when the confirmation is accepted', async () => {
    render(<App />)
    await addAndGenerate(referencePreview())

    fireEvent.click(screen.getByRole('button', { name: 'Clear session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear session' }))

    // A completely fresh session: nothing confirmed, nothing to generate.
    await screen.findByLabelText('Quotation PDF file')
    expect(screen.queryByText(/quotation ready for Excel/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /generate consolidated workbook/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('table', { name: /quotations already added/i }),
    ).not.toBeInTheDocument()
  })

  it('moves keyboard focus to the question and offers two real choices', async () => {
    render(<App />)
    await addAndGenerate(referencePreview())

    fireEvent.click(screen.getByRole('button', { name: 'Clear session' }))

    // Focus moves to the question, so the choice is announced and reachable.
    expect(screen.getByText(/clear all quotations\?/i)).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Keep session' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear session' })).toBeInTheDocument()
  })

  it('dismisses the question with the Escape key', async () => {
    render(<App />)
    await addAndGenerate(referencePreview())

    fireEvent.click(screen.getByRole('button', { name: 'Clear session' }))
    expect(screen.getByText(/clear all quotations\?/i)).toBeInTheDocument()

    fireEvent.keyDown(screen.getByText(/clear all quotations\?/i), { key: 'Escape' })

    expect(screen.queryByText(/clear all quotations\?/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download excel/i })).toBeInTheDocument()
  })
})

describe('quotation-added feedback', () => {
  async function addOne(name = 'first.pdf', preview = referencePreview()) {
    parse.mockResolvedValueOnce(preview)
    chooseAndRead(pdfFile(name))
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')
  }

  it('confirms the quotation was added to the session', async () => {
    render(<App />)
    await addOne()

    const confirmation = screen.getByText(/quotation added to session/i)
    expect(confirmation.closest('.notice')).toHaveClass('notice--success')
    expect(screen.getByText(/sequence 001 has been assigned/i)).toBeInTheDocument()
    expect(
      screen.getByText(/upload another quotation or generate the Excel workbook/i),
    ).toBeInTheDocument()
  })

  it('never claims the Excel workbook was written', async () => {
    render(<App />)
    await addOne()

    expect(screen.queryByText(/added to excel/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/workbook updated/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/excel file generated/i)).not.toBeInTheDocument()
    expect(genConsolidated).not.toHaveBeenCalled()
  })

  it('clears the confirmation once another quotation is being read', async () => {
    render(<App />)
    await addOne()
    expect(screen.getByText(/quotation added to session/i)).toBeInTheDocument()

    // Reading the next file is a new task, so the old confirmation goes away.
    parse.mockResolvedValueOnce(referencePreview('QDXB/25/014095/Rev1'))
    chooseAndRead(pdfFile('second.pdf'))
    await reviewScreen()
    expect(screen.queryByText(/quotation added to session/i)).not.toBeInTheDocument()
  })
})

describe('the SR# is treated as an identifier, not a number', () => {
  it('shows the hierarchical SR# exactly as the ERP printed it', async () => {
    parse.mockResolvedValueOnce(hierarchicalPreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()

    // The trailing zeros are part of the identifier, so the boxes show the text.
    expect(screen.getByLabelText('Line 1 SR#')).toHaveValue('1.1')
    expect(screen.getByLabelText('Line 2 SR#')).toHaveValue('1.130')
    expect(screen.getByLabelText('Line 3 SR#')).toHaveValue('7.90')
    expect(screen.getByLabelText('Line 4 SR#')).toHaveValue('9.133')
  })

  it('does not let the browser reinterpret a typed SR#', async () => {
    parse.mockResolvedValueOnce(hierarchicalPreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()
    const sr = screen.getByLabelText('Line 2 SR#')

    // A number box would strip this back to 7.9 and 007 to 7.
    fireEvent.change(sr, { target: { value: '007.90' } })

    expect(screen.getByLabelText('Line 2 SR#')).toHaveValue('007.90')
  })

  it('sends the SR# to the backend as text', async () => {
    parse.mockResolvedValueOnce(hierarchicalPreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')

    genConsolidated.mockResolvedValueOnce(new Blob(['mock']))
    fireEvent.click(screen.getByRole('button', { name: /generate consolidated workbook/i }))
    await waitFor(() => expect(genConsolidated).toHaveBeenCalledTimes(1))

    const sent = genConsolidated.mock.calls[0][0].quotations[0].quotation.items.map(
      (item) => item.sr,
    )
    // {"sr": "1.130"}, not {"sr": 1.13}: the payload is what the backend reads.
    expect(sent).toEqual(['1.1', '1.130', '7.90', '9.133'])
    expect(sent.every((sr) => typeof sr === 'string')).toBe(true)
  })

  it('still treats quantity as a number', async () => {
    parse.mockResolvedValueOnce(hierarchicalPreview())
    render(<App />)

    chooseAndRead(pdfFile())
    await reviewScreen()

    expect(screen.getByLabelText('Line 1 quantity')).toHaveValue(5082)
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '7.5' } })
    expect(screen.getByLabelText('Line 1 quantity')).toHaveValue(7.5)
  })
})

describe('read-only session preview', () => {
  async function addOne() {
    parse.mockResolvedValueOnce(referencePreview())
    chooseAndRead(pdfFile('first.pdf'))
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')
  }

  it('says the quotation is already saved and cannot be edited here', async () => {
    render(<App />)
    await addOne()

    fireEvent.click(screen.getByRole('button', { name: /view details for sequence 001/i }))

    const banner = await screen.findByText(/viewing saved quotation/i)
    expect(banner.closest('.notice')).toHaveClass('notice--info')
    // The banner names the exact quotation on screen.
    expect(banner.parentElement).toHaveTextContent('Sequence 001')
    expect(banner.parentElement).toHaveTextContent('QDXB/25/014094/Rev1')
    expect(screen.getByText(/cannot be edited here/i)).toBeInTheDocument()
    // Informational, not a warning.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('leaves the session untouched when the preview is closed', async () => {
    render(<App />)
    await addOne()

    fireEvent.click(screen.getByRole('button', { name: /view details for sequence 001/i }))
    await screen.findByText(/viewing saved quotation/i)
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))

    await screen.findByLabelText('Quotation PDF file')
    const table = screen.getByRole('table', { name: /quotations already added/i })
    expect(within(table).getByRole('row', { name: /001/ })).toBeInTheDocument()
    expect(screen.getByText(/1 quotation ready for Excel/i)).toBeInTheDocument()

    // And the workbook still carries the same, unchanged quotation.
    genConsolidated.mockResolvedValueOnce(new Blob(['mock']))
    fireEvent.click(screen.getByRole('button', { name: /generate consolidated workbook/i }))
    await waitFor(() => expect(genConsolidated).toHaveBeenCalledTimes(1))
    const request = genConsolidated.mock.calls[0][0]
    expect(request.quotations.map((q) => q.sequence_number)).toEqual(['001'])
    expect(request.quotations[0].quotation.quotation_number).toBe('QDXB/25/014094/Rev1')
  })
})

describe('review action area and scanning', () => {
  async function toReview(preview = referencePreview()) {
    parse.mockResolvedValueOnce(preview)
    chooseAndRead(pdfFile('first.pdf'))
    await reviewScreen()
  }

  it('keeps exactly one Add to Workbook action, in the review action area', async () => {
    render(<App />)
    await toReview()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()

    // One button, not two independently working copies.
    expect(screen.getAllByRole('button', { name: 'Add to Workbook' })).toHaveLength(1)
    const add = screen.getByRole('button', { name: 'Add to Workbook' })
    expect(add.closest('.review-actions')).toBeInTheDocument()
    expect(add).toBeEnabled()

    // And it still works from there.
    fireEvent.click(add)
    await screen.findByLabelText('Quotation PDF file')
    expect(screen.getByText(/1 quotation ready for Excel/i)).toBeInTheDocument()
  })

  it('keeps Add to Workbook and Cancel in the same action area', async () => {
    render(<App />)
    await toReview()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()

    const bar = screen
      .getByRole('button', { name: 'Add to Workbook' })
      .closest('.review-actions') as HTMLElement
    expect(within(bar).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    // Add to Workbook keeps the primary styling; Cancel stays secondary.
    expect(within(bar).getByRole('button', { name: 'Add to Workbook' })).toHaveClass('primary')
    expect(within(bar).getByRole('button', { name: 'Cancel' })).toHaveClass('secondary')
  })

  it('shows the sequence number and review state in the action area', async () => {
    render(<App />)
    await toReview()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()

    const bar = screen
      .getByRole('button', { name: 'Add to Workbook' })
      .closest('.review-actions') as HTMLElement
    expect(bar).toHaveTextContent('Sequence 001')
    expect(bar).toHaveTextContent(/line item needs attention/i)
  })

  it('summarises what needs review in plain words', async () => {
    render(<App />)
    await toReview()

    expect(screen.getByText('Review required')).toBeInTheDocument()
    expect(
      screen.getByText(/1 line item needs attention before this quotation can be added/i),
    ).toBeInTheDocument()
  })

  it('reports a quotation with no flagged fields as ready', async () => {
    const clean = referencePreview()
    clean.review = []
    render(<App />)
    await toReview(clean)

    expect(screen.getByText('Ready for review')).toBeInTheDocument()
    expect(
      screen.getByText(/all extracted fields passed the current validation checks/i),
    ).toBeInTheDocument()
    expect(screen.queryByText('Review required')).not.toBeInTheDocument()
  })

  it('counts header fields and line items separately', async () => {
    const both = referencePreview()
    both.review = [
      { field: 'project_name', reason: 'missing', message: 'Check the project name.' },
      { field: 'items[1].quantity', reason: 'missing', message: 'Check the quantity.' },
    ]
    render(<App />)
    await toReview(both)

    expect(
      screen.getByText(
        /1 quotation field and 1 line item need attention before this quotation can be added/i,
      ),
    ).toBeInTheDocument()
  })

  it('shows how many line items were read', async () => {
    render(<App />)
    await toReview()

    const section = screen.getByRole('heading', { name: 'Line items' }).closest('.card') as HTMLElement
    expect(within(section).getByText('3 items')).toBeInTheDocument()
  })

  it('leaves Cancel working and non-destructive from the action area', async () => {
    render(<App />)

    parse.mockResolvedValueOnce(referencePreview())
    chooseAndRead(pdfFile('first.pdf'))
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')

    parse.mockResolvedValueOnce(alpagoPreview())
    chooseAndRead(pdfFile('second.pdf'))
    await reviewScreen()
    const reviewBar = screen
      .getByRole('button', { name: 'Confirm quotation' })
      .closest('.review-actions') as HTMLElement
    fireEvent.click(within(reviewBar).getByRole('button', { name: 'Cancel' }))

    await screen.findByLabelText('Quotation PDF file')
    const table = screen.getByRole('table', { name: /quotations already added/i })
    // Header row plus the one quotation that was really added.
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).getByRole('row', { name: /001/ })).toBeInTheDocument()
  })
})

/**
 * Phase 5C-A: a new quotation continues from the monitoring workbook the user
 * opened, rather than restarting the count at 001.
 *
 * The workbook lives in OneDrive and already holds 001 to 007, so adding an
 * eighth quotation to it has to be numbered 008. These tests drive the real
 * screen: the only stub is the network, and the number that comes out is read
 * from the same `<output>` the mother reads.
 *
 * The workbook's rows are the user's to correct, but its highest Sequence Number
 * is identity rather than content, so editing a client name or a status must not
 * move the number. And because the number is worked out from what is already
 * there rather than set aside, a cancelled draft gives its number back.
 */
describe('numbering continues from an imported monitor', () => {
  function monitorRow(overrides: Partial<ImportedMonitorRow> = {}): ImportedMonitorRow {
    return {
      sequence_number: '007',
      client_name: 'SAMPLE CLIENT TRADING L.L.C',
      project_name: 'MBRC 466',
      product_description: 'Engineered Oak Flooring 15/4 x 120 x 600mm',
      quantity: 34,
      unit_of_measurement: 'm2',
      installation_schedule: '',
      start_date: null,
      completion_date: null,
      status: 'On Hold',
      ...overrides,
    }
  }

  /** A monitoring workbook whose highest Sequence Number is 007. */
  function monitorAt007(rows?: ImportedMonitorRow[]): ImportedMonitor {
    const found = rows ?? [monitorRow()]
    return {
      rows: found,
      highest_sequence: '007',
      row_count: found.length,
      source_filename: 'monitoring_sheet.xlsx',
    }
  }

  function monitorSection() {
    return screen.getByRole('region', { name: /continue existing monitor/i })
  }

  /** Opens the existing workbook and waits for it to be shown. */
  async function openMonitor(monitor: ImportedMonitor = monitorAt007()) {
    monitorImport.mockResolvedValue(monitor)
    render(<App />)
    const file = new File([`xlsx::${Date.now()}::${Math.random()}`], 'monitoring_sheet.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    fireEvent.change(within(monitorSection()).getByLabelText('Monitoring Excel file'), {
      target: { files: [file] },
    })
    fireEvent.click(within(monitorSection()).getByRole('button', { name: /upload monitor excel/i }))
    await within(monitorSection()).findByText(/existing monitor loaded/i)
  }

  /** Reads a PDF and stops on the step where the number is offered. */
  async function reachSequenceStep(preview: QuotationPreview, name = 'quote.pdf') {
    parse.mockResolvedValueOnce(preview)
    chooseAndRead(pdfFile(name))
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    return sequenceScreen()
  }

  /** The number currently on offer, as a user reads it. */
  function offeredSequence() {
    return screen.getByLabelText('Sequence Number').textContent
  }

  it('offers 008 when the workbook has already reached 007', async () => {
    await openMonitor()
    await reachSequenceStep(referencePreview())

    // Not 001: this quotation is being added to a workbook that has seven
    // sequence numbers' worth of history behind it.
    expect(offeredSequence()).toBe('008')
  })

  it('carries on to 009 after the first new quotation is added', async () => {
    await openMonitor()

    await reachSequenceStep(referencePreview(), 'first.pdf')
    expect(offeredSequence()).toBe('008')
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')

    await reachSequenceStep(alpagoPreview(), 'second.pdf')
    expect(offeredSequence()).toBe('009')
  })

  it('gives the number back when a draft is cancelled', async () => {
    await openMonitor()

    // The first draft is shown 008 and then abandoned.
    await reachSequenceStep(referencePreview(), 'abandoned.pdf')
    expect(offeredSequence()).toBe('008')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await screen.findByLabelText('Quotation PDF file')

    // Nothing was ever written, so 008 is still free. A number that had been
    // set aside rather than worked out would now read 009.
    await reachSequenceStep(alpagoPreview(), 'second.pdf')
    expect(offeredSequence()).toBe('008')
  })

  it('keeps the same number after the monitor rows are edited', async () => {
    await openMonitor()

    // Correct the workbook the way the mother would, then leave the editor.
    fireEvent.click(within(monitorSection()).getByRole('button', { name: /edit monitor/i }))
    const clientName = await within(monitorSection()).findByLabelText('Client Name, row 1')
    fireEvent.change(clientName, { target: { value: 'ALPAGO DESIGN AND BUILD' } })
    fireEvent.click(within(monitorSection()).getByRole('button', { name: /save changes/i }))

    await reachSequenceStep(referencePreview())

    // A client name is content. It says nothing about which numbers are taken.
    expect(offeredSequence()).toBe('008')
  })

  it('still numbers from the workbook after the quotation session is cleared', async () => {
    await openMonitor()

    await reachSequenceStep(referencePreview(), 'first.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')

    // Clear the quotations by generating and then clearing, which is the only
    // route to that button.
    genConsolidated.mockResolvedValueOnce(new Blob(['mock']))
    fireEvent.click(screen.getByRole('button', { name: /generate consolidated workbook/i }))
    await screen.findByRole('heading', { name: /excel file generated/i })
    fireEvent.click(screen.getByRole('button', { name: 'Clear session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear session' }))
    await screen.findByLabelText('Quotation PDF file')

    // Clearing removes the quotations added in this session. It does not forget
    // the workbook, which is the file the next quotation is being added to.
    expect(within(monitorSection()).getByText(/existing monitor loaded/i)).toBeInTheDocument()

    await reachSequenceStep(alpagoPreview(), 'second.pdf')
    expect(offeredSequence()).toBe('008')
  })

  it('never turns the workbook sequence number into something she can type', async () => {
    await openMonitor()

    fireEvent.click(within(monitorSection()).getByRole('button', { name: /edit monitor/i }))
    await waitFor(() =>
      expect(within(monitorSection()).getByRole('button', { name: /save changes/i })).toBeInTheDocument(),
    )

    // Now that the workbook takes part in numbering, it would be easy to let the
    // identifier be edited by accident. It stays a value, not a box.
    expect(within(monitorSection()).queryByLabelText('Sequence Number, row 1')).toBeNull()
    expect(within(monitorSection()).getAllByText('007')).not.toHaveLength(0)
  })
})

/**
 * Phase 5C-B2: the workbook the user already opened goes into the generated file.
 *
 * The mother keeps the monitoring workbook in OneDrive and comes back to it later.
 * Opening it shows the rows it holds, and a new quotation is then added to that
 * same file rather than starting a fresh one. So the request carries both: the
 * rows that were already there, and the new quotation.
 *
 * They travel in separate fields and are never merged, because they are not the
 * same kind of thing. A monitoring row is a finished Summary row the user owns,
 * complete with the schedule, date and status they set in Excel; a quotation is a
 * list of items still to be unpacked. Folding one into the other would invent a
 * client, a project and a blank status for every row being maintained.
 *
 * Which rows are authoritative is the question these tests answer. The saved rows
 * are, and only they. The working copy being edited is not, so an edit the user
 * has not confirmed must either be saved first or stop the generation outright --
 * a workbook that quietly left it out would be a file the user believes they
 * checked and has not.
 */
describe('adding a quotation to an existing monitoring workbook', () => {
  function monitorRow(overrides: Partial<ImportedMonitorRow> = {}): ImportedMonitorRow {
    return {
      sequence_number: '001',
      client_name: 'SAMPLE CLIENT TRADING L.L.C',
      project_name: 'MBRC 466',
      product_description: 'Engineered Oak Flooring 15/4 x 120 x 600mm',
      quantity: 34,
      unit_of_measurement: 'm2',
      installation_schedule: '',
      start_date: null,
      completion_date: null,
      status: 'On Hold',
      ...overrides,
    }
  }

  /** The workbook the mother already shares: two rows, highest number 007. */
  function existingWorkbook(): ImportedMonitor {
    const rows = [
      monitorRow({
        sequence_number: '001',
        product_description: 'Engineered Oak Flooring 15/4 x 120 x 600mm',
        installation_schedule: '01-05 Sep 2026',
        start_date: '2026-09-01',
        completion_date: '2026-09-05',
        status: 'Completed',
      }),
      monitorRow({
        sequence_number: '007',
        project_name: 'Marina Bay Tower',
        product_description: 'Self-levelling up to 3mm',
        quantity: 122,
        installation_schedule: '15-20 Nov 2026',
        start_date: '2026-11-15',
        status: 'Ongoing',
      }),
    ]
    return {
      rows,
      highest_sequence: '007',
      row_count: rows.length,
      source_filename: 'monitoring_sheet.xlsx',
    }
  }

  function monitorSection() {
    return screen.getByRole('region', { name: /continue existing monitor/i })
  }

  /** Opens a monitoring workbook and waits for it to be shown. */
  async function openMonitor(monitor: ImportedMonitor = existingWorkbook()) {
    monitorImport.mockResolvedValue(monitor)
    render(<App />)
    const file = new File([`xlsx::${Date.now()}::${Math.random()}`], 'monitoring_sheet.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    fireEvent.change(within(monitorSection()).getByLabelText('Monitoring Excel file'), {
      target: { files: [file] },
    })
    fireEvent.click(within(monitorSection()).getByRole('button', { name: /upload monitor excel/i }))
    await within(monitorSection()).findByText(/existing monitor loaded/i)
  }

  /** Reads a PDF, confirms it, and adds it to the session at 008. */
  async function addQuotation(preview: QuotationPreview = referencePreview(), name = 'quote.pdf') {
    parse.mockResolvedValueOnce(preview)
    chooseAndRead(pdfFile(name))
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')
  }

  /** Opens the monitor editor, which is the only mode with inputs in it. */
  async function openEditor() {
    fireEvent.click(within(monitorSection()).getByRole('button', { name: /edit monitor/i }))
    await waitFor(() =>
      expect(
        within(monitorSection()).getByRole('button', { name: /save changes/i }),
      ).toBeInTheDocument(),
    )
  }

  function type(rowNumber: number, name: string, value: string) {
    fireEvent.change(within(monitorSection()).getByLabelText(`${name}, row ${rowNumber}`), {
      target: { value },
    })
  }

  function save() {
    fireEvent.click(within(monitorSection()).getByRole('button', { name: /save changes/i }))
  }

  function cancelEdits() {
    fireEvent.click(within(monitorSection()).getByRole('button', { name: /^cancel$/i }))
  }

  function generate() {
    genConsolidated.mockResolvedValueOnce(new Blob(['mock']))
    fireEvent.click(screen.getByRole('button', { name: /generate consolidated workbook/i }))
  }

  /**
   * The `existing_rows` the backend was sent.
   *
   * The API function is typed with the wire contract, where the field is optional
   * so a caller may omit it. This one must not: an absent field is the failure
   * these tests exist to catch, so its presence is asserted rather than defaulted
   * away with `?? []`, which would let that failure pass.
   */
  function sentExistingRows(): ImportedMonitorRow[] {
    const request = genConsolidated.mock.calls[0][0]
    expect(request).toHaveProperty('existing_rows')
    expect(request.existing_rows).not.toBeUndefined()
    return request.existing_rows as ImportedMonitorRow[]
  }

  it('sends the existing rows and the new quotation in one request', async () => {
    await openMonitor()
    await addQuotation()
    generate()
    await waitFor(() => expect(genConsolidated).toHaveBeenCalledTimes(1))

    const request = genConsolidated.mock.calls[0][0]
    expect(sentExistingRows().map((row) => row.sequence_number)).toEqual(['001', '007'])
    expect(request.quotations.map((q: { sequence_number: string }) => q.sequence_number)).toEqual([
      '008',
    ])
  })

  it('sends the existing rows whole, including what the user filled in by hand', async () => {
    await openMonitor()
    await addQuotation()
    generate()
    await waitFor(() => expect(genConsolidated).toHaveBeenCalledTimes(1))

    // A schedule, a date and a status set in Excel are the user's own work. If
    // they were dropped, the file they share would lose them.
    const [first, second] = sentExistingRows()
    expect(first).toEqual(existingWorkbook().rows[0])
    expect(second).toEqual(existingWorkbook().rows[1])
    expect(second.installation_schedule).toBe('15-20 Nov 2026')
    expect(second.status).toBe('Ongoing')
  })

  it('keeps a monitoring row out of the quotations', async () => {
    await openMonitor()
    await addQuotation()
    generate()
    await waitFor(() => expect(genConsolidated).toHaveBeenCalledTimes(1))

    const { quotations } = genConsolidated.mock.calls[0][0]
    expect(quotations).toHaveLength(1)
    // The new quotation is the ERP one, not a row read from the workbook.
    expect(quotations[0].sequence_number).toBe('008')
    expect(quotations[0].quotation.client_name).toBe(
      'ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C',
    )
  })

  it('does not list a monitoring row in the session of quotations', async () => {
    await openMonitor()
    await addQuotation()

    // Opening a workbook only reads it. Its rows are not quotations and must not
    // appear as though they had been added to this session.
    const table = screen.getByRole('table', {
      name: /quotations already added to this session/i,
    })
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).getByRole('row', { name: /008/ })).toBeInTheDocument()
    expect(within(table).queryByRole('row', { name: /001/ })).toBeNull()
  })

  it('sends a saved edit so a correction reaches the workbook', async () => {
    await openMonitor()
    await openEditor()
    type(1, 'Client Name', 'CORRECTED CLIENT NAME')
    save()
    await addQuotation()
    generate()
    await waitFor(() => expect(genConsolidated).toHaveBeenCalledTimes(1))

    expect(sentExistingRows()[0].client_name).toBe('CORRECTED CLIENT NAME')
  })

  it('sends the original value after an edit is cancelled', async () => {
    await openMonitor()
    await openEditor()
    type(1, 'Client Name', 'DISCARDED EDIT')
    cancelEdits()
    await addQuotation()
    generate()
    await waitFor(() => expect(genConsolidated).toHaveBeenCalledTimes(1))

    // Cancel returns to the last confirmed state, and that is what is sent. The
    // file must not carry an edit she threw away.
    expect(sentExistingRows()[0].client_name).toBe('SAMPLE CLIENT TRADING L.L.C')
  })

  it('refuses to generate while a monitor edit is unsaved', async () => {
    // The Generate button sits on the upload screen, so it is reachable while the
    // monitor editor is still open. Generating here would produce a file that
    // silently omits the edit, and she would have no way of knowing.
    await openMonitor()
    await addQuotation()
    await openEditor()
    type(1, 'Client Name', 'UNSAVED EDIT')

    generate()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Save or cancel your monitor changes before generating the workbook.',
    )
    expect(genConsolidated).not.toHaveBeenCalled()
  })

  it('generates once the unsaved edit is saved', async () => {
    await openMonitor()
    await addQuotation()
    await openEditor()
    type(1, 'Client Name', 'SAVED EDIT')

    // Guarded, so the save is what unblocks it.
    generate()
    await screen.findByRole('alert')
    expect(genConsolidated).not.toHaveBeenCalled()

    save()
    generate()
    await waitFor(() => expect(genConsolidated).toHaveBeenCalledTimes(1))
    expect(sentExistingRows()[0].client_name).toBe('SAVED EDIT')
  })

  it('generates once the unsaved edit is cancelled', async () => {
    await openMonitor()
    await addQuotation()
    await openEditor()
    type(1, 'Client Name', 'DISCARDED EDIT')

    generate()
    await screen.findByRole('alert')
    expect(genConsolidated).not.toHaveBeenCalled()

    cancelEdits()
    generate()
    await waitFor(() => expect(genConsolidated).toHaveBeenCalledTimes(1))
    expect(sentExistingRows()[0].client_name).toBe('SAMPLE CLIENT TRADING L.L.C')
  })

  it('does not let a second click through while the first is refused', async () => {
    await openMonitor()
    await addQuotation()
    await openEditor()
    type(1, 'Client Name', 'UNSAVED EDIT')

    generate()
    await screen.findByRole('alert')
    generate()

    expect(genConsolidated).not.toHaveBeenCalled()
  })

  it('preserves a leading zero on both the existing rows and the new quotation', async () => {
    await openMonitor()
    await addQuotation()
    generate()
    await waitFor(() => expect(genConsolidated).toHaveBeenCalledTimes(1))

    const request = genConsolidated.mock.calls[0][0]
    const rows = sentExistingRows()
    // Read as numbers these would become 1, 7 and 8, quietly renumbering the file.
    expect(rows.map((row) => row.sequence_number)).toEqual(['001', '007'])
    expect(request.quotations[0].sequence_number).toBe('008')
    rows.forEach((row) => expect(typeof row.sequence_number).toBe('string'))
    expect(typeof request.quotations[0].sequence_number).toBe('string')
  })

  it('sends no app-only fields with the quotation', async () => {
    await openMonitor()
    await addQuotation()
    generate()
    await waitFor(() => expect(genConsolidated).toHaveBeenCalledTimes(1))

    // The confirmed quotation carries a fingerprint and a source for this
    // application's own duplicate check and session preview. The backend model
    // forbids unknown properties, so they must not travel.
    const request = genConsolidated.mock.calls[0][0]
    expect(Object.keys(request.quotations[0]).sort()).toEqual(['quotation', 'sequence_number'])
    expect(JSON.stringify(request)).not.toContain('fingerprint')
  })
})

describe('generating without a monitoring workbook', () => {
  it('sends an empty existing_rows list and leaves the quotation payload alone', async () => {
    render(<App />)
    parse.mockResolvedValueOnce(referencePreview())
    chooseAndRead(pdfFile())
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')

    genConsolidated.mockResolvedValueOnce(new Blob(['mock']))
    fireEvent.click(screen.getByRole('button', { name: /generate consolidated workbook/i }))
    await waitFor(() => expect(genConsolidated).toHaveBeenCalledTimes(1))

    // No workbook has been opened, so the field is present and empty. Behaviour
    // is otherwise exactly what it was before this field existed.
    const request = genConsolidated.mock.calls[0][0]
    expect(request).toHaveProperty('existing_rows')
    expect(request.existing_rows).toEqual([])
    expect(request.quotations).toHaveLength(1)
    expect(request.quotations[0].sequence_number).toBe('001')
    expect(request.quotations[0].quotation.client_name).toBe(
      'ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C',
    )
  })

  it('does not block generation when no monitor has ever been opened', async () => {
    // The guard must not fire on an empty draft. A session with no workbook at
    // all is the common case and has nothing unsaved to lose.
    render(<App />)
    parse.mockResolvedValueOnce(referencePreview())
    chooseAndRead(pdfFile())
    await reviewScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
    await sequenceScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
    await screen.findByLabelText('Quotation PDF file')

    genConsolidated.mockResolvedValueOnce(new Blob(['mock']))
    fireEvent.click(screen.getByRole('button', { name: /generate consolidated workbook/i }))

    await screen.findByRole('heading', { name: /excel file generated/i })
    expect(genConsolidated).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
