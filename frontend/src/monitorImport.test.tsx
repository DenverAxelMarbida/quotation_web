/**
 * Phase 5A: opening a monitoring workbook that already exists.
 *
 * The user keeps that file in OneDrive and comes back to it later, so the upload
 * screen needs a way to open it. These tests drive the real component through the
 * screen a person sees, with only the API module mocked.
 *
 * The imported rows are a read-only preview. They can be looked at, and nothing
 * else: the section must not offer to edit them, and they must not join the
 * quotation session. What the workbook does contribute is its highest Sequence
 * Number, so a quotation added to it is numbered after the file rather than
 * starting again at 001 (Phase 5C-A).
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ApiError } from './api/client'
import { importMonitor } from './api/monitor'
import { parseQuotation } from './api/quotations'
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

/** A row as the backend returns it, with every field spelled out. */
function row(overrides: Partial<ImportedMonitorRow> = {}): ImportedMonitorRow {
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

/** A monitoring workbook holding three rows across two sequence numbers. */
function importedMonitor(overrides: Partial<ImportedMonitor> = {}): ImportedMonitor {
  return {
    rows: [
      row({ product_description: 'Engineered Oak Flooring 15/4 x 120 x 600mm', quantity: 34 }),
      row({
        product_description: 'Engineered Oak Flooring 16/4 x 220 x RLmm',
        quantity: 88,
      }),
      row({
        sequence_number: '002',
        project_name: 'Marina Bay Tower',
        product_description: 'Self-levelling up to 3mm',
        quantity: 122,
        status: 'On Hold',
      }),
    ],
    highest_sequence: '002',
    row_count: 3,
    source_filename: 'monitoring_sheet.xlsx',
    ...overrides,
  }
}

/** A quotation preview, for the checks that the two features do not interact. */
function quotationPreview(): QuotationPreview {
  return {
    quotation: {
      quotation_number: 'QDXB/25/014094/Rev1',
      client_name: 'ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C',
      project_name: 'MBRC 466',
      items: [
        { sr: '1', description: 'Vinyl flooring sheet 2mm', quantity: 200, unit: 'm2' },
      ],
    },
    review: [],
    source: { filename: 'quotation.pdf', page_count: 1, warnings: [] },
  }
}

let fileCounter = 0

function monitorFile(name = 'monitoring_sheet.xlsx'): File {
  return new File([`xlsx::${name}::${fileCounter++}`], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

function pdfFile(name = 'quote.pdf'): File {
  return new File([`pdf::${name}::${fileCounter++}`], name, { type: 'application/pdf' })
}

function section() {
  return screen.getByRole('region', { name: /continue existing monitor/i })
}

function previewTable() {
  return within(section()).getByRole('table', {
    name: /rows found in the uploaded monitoring workbook/i,
  })
}

/** Selects the workbook and asks for it to be opened. */
function chooseAndImport(file: File) {
  fireEvent.change(within(section()).getByLabelText('Monitoring Excel file'), {
    target: { files: [file] },
  })
  fireEvent.click(within(section()).getByRole('button', { name: /upload monitor excel/i }))
}

/** Selects a quotation PDF and asks for it to be read. */
function chooseAndRead(file: File) {
  fireEvent.change(screen.getByLabelText('Quotation PDF file'), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: 'Read quotation' }))
}

async function reachSequenceStep() {
  parse.mockResolvedValueOnce(quotationPreview())
  chooseAndRead(pdfFile())
  await screen.findByRole('heading', { name: /check the quotation details/i, level: 2 })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
  return screen.findByRole('heading', { name: /assign sequence number/i, level: 2 })
}

beforeEach(() => {
  monitorImport.mockReset()
  parse.mockReset()
})

describe('the continue existing monitor section', () => {
  it('is offered next to the quotation upload, not instead of it', () => {
    render(<App />)

    expect(section()).toBeInTheDocument()
    expect(within(section()).getByLabelText('Monitoring Excel file')).toHaveAttribute(
      'accept',
      expect.stringContaining('.xlsx') as unknown as string,
    )
    expect(
      within(section()).getByRole('button', { name: /upload monitor excel/i }),
    ).toBeInTheDocument()
    // The original workflow is still right there.
    expect(screen.getByLabelText('Quotation PDF file')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Read quotation' })).toBeInTheDocument()
  })

  it('keeps the two file inputs apart', () => {
    render(<App />)

    fireEvent.change(within(section()).getByLabelText('Monitoring Excel file'), {
      target: { files: [monitorFile('chosen_monitor.xlsx')] },
    })

    // Choosing a workbook must not look like choosing a quotation PDF.
    expect(within(section()).getByText('chosen_monitor.xlsx')).toBeInTheDocument()
    expect(screen.getByText('chosen_monitor.xlsx')).toBeInTheDocument()
  })

  it('asks for a file before sending anything to the backend', () => {
    render(<App />)

    fireEvent.click(within(section()).getByRole('button', { name: /upload monitor excel/i }))

    expect(monitorImport).not.toHaveBeenCalled()
    expect(within(section()).getByText(/choose the monitoring excel file first/i)).toBeInTheDocument()
  })

  it('sends the chosen file to the import endpoint', async () => {
    monitorImport.mockResolvedValue(importedMonitor())
    render(<App />)

    const file = monitorFile('monitoring_sheet.xlsx')
    chooseAndImport(file)

    await within(section()).findByText(/existing monitor loaded/i)
    expect(monitorImport).toHaveBeenCalledTimes(1)
    expect(monitorImport.mock.calls[0][0]).toBe(file)
  })
})

describe('the imported monitor preview', () => {
  it('shows every row that was found', async () => {
    monitorImport.mockResolvedValue(importedMonitor())
    render(<App />)

    chooseAndImport(monitorFile())

    const table = await waitFor(previewTable)
    // Header row plus the three imported rows.
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(
      within(table).getByText('Engineered Oak Flooring 15/4 x 120 x 600mm'),
    ).toBeInTheDocument()
    expect(within(table).getByText('Self-levelling up to 3mm')).toBeInTheDocument()
  })

  it('confirms which file was opened and how much it holds', async () => {
    monitorImport.mockResolvedValue(importedMonitor())
    render(<App />)

    chooseAndImport(monitorFile('monitoring_sheet.xlsx'))

    expect(await within(section()).findByText(/existing monitor loaded/i)).toBeInTheDocument()
    expect(within(section()).getByText('monitoring_sheet.xlsx')).toBeInTheDocument()
    expect(within(section()).getByText(/3 rows/i)).toBeInTheDocument()
  })

  it('keeps rows that share one sequence number as separate rows', async () => {
    // One quotation is several rows, and the quantity is per line item.
    monitorImport.mockResolvedValue(importedMonitor())
    render(<App />)

    chooseAndImport(monitorFile())

    const table = await waitFor(previewTable)
    expect(within(table).getAllByRole('row', { name: /^\s*001/ })).toHaveLength(2)
    expect(within(table).getByRole('row', { name: /^\s*002/ })).toBeInTheDocument()
  })

  it('shows a sequence number with its leading zeros intact', async () => {
    // 007 is an identifier. Read as a number it would come back as 7, which
    // would renumber a project the user has been tracking by 007.
    monitorImport.mockResolvedValue(
      importedMonitor({
        rows: [row({ sequence_number: '007' })],
        highest_sequence: '007',
        row_count: 1,
      }),
    )
    render(<App />)

    chooseAndImport(monitorFile())

    const table = await waitFor(previewTable)
    expect(within(table).getByRole('row', { name: /007/ })).toBeInTheDocument()
    expect(within(table).queryByText('7')).not.toBeInTheDocument()
  })

  it('reports the sequence range the workbook had reached', async () => {
    // The range is shown as identifiers, so a workbook that skipped a value
    // reads as what it is rather than as a count.
    monitorImport.mockResolvedValue(
      importedMonitor({
        rows: [row({ sequence_number: '001' }), row({ sequence_number: '007' })],
        highest_sequence: '007',
        row_count: 2,
      }),
    )
    render(<App />)

    chooseAndImport(monitorFile())

    expect(await within(section()).findByText(/sequences 001–007/i)).toBeInTheDocument()
  })

  it('leaves a blank schedule, date or status visible as a gap', async () => {
    // Nothing is filled in to make the preview look complete.
    monitorImport.mockResolvedValue(importedMonitor())
    render(<App />)

    chooseAndImport(monitorFile())

    const table = await waitFor(previewTable)
    const third = within(table).getByRole('row', { name: /002/ })
    expect(within(third).getAllByText('—')).toHaveLength(3)
  })

  it('shows the installation schedule and start date already in the workbook', async () => {
    monitorImport.mockResolvedValue(
      importedMonitor({
        rows: [row({ installation_schedule: '14/03/2026', start_date: '05/01/2026' })],
        row_count: 1,
        highest_sequence: '001',
      }),
    )
    render(<App />)

    chooseAndImport(monitorFile())

    const table = await waitFor(previewTable)
    expect(within(table).getByText('14/03/2026')).toBeInTheDocument()
    expect(within(table).getByText('05/01/2026')).toBeInTheDocument()
  })

  it('shows the status that each row\'s own dates support', async () => {
    // The workbook holds dates, not opinions: On Hold for a row with nothing
    // set, Ongoing for one scheduled and started, Completed for one finished.
    monitorImport.mockResolvedValue(
      importedMonitor({
        rows: [
          row({ sequence_number: '001', status: 'On Hold' }),
          row({
            sequence_number: '002',
            installation_schedule: 'November 2026',
            start_date: '2026-11-01',
            status: 'Ongoing',
          }),
          row({
            sequence_number: '003',
            installation_schedule: '01-05 Nov 2026',
            start_date: '2026-11-01',
            completion_date: '2026-11-05',
            status: 'Completed',
          }),
        ],
        highest_sequence: '003',
        row_count: 3,
      }),
    )
    render(<App />)

    chooseAndImport(monitorFile())

    const table = await waitFor(previewTable)
    expect(within(table).getByText('On Hold')).toBeInTheDocument()
    expect(within(table).getByText('Ongoing')).toBeInTheDocument()
    expect(within(table).getByText('Completed')).toBeInTheDocument()
  })

  it('offers nothing that could change what was read', async () => {
    // The workbook belongs to the user and is the record of record. The preview
    // must not look like an editable form.
    monitorImport.mockResolvedValue(importedMonitor())
    render(<App />)

    chooseAndImport(monitorFile())

    const table = await waitFor(previewTable)
    expect(within(table).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(table).queryByRole('button')).not.toBeInTheDocument()
    expect(within(table).queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('does not offer to write anything back to the workbook', async () => {
    // Phase 5A imported read-only and could not be edited. Phase 5B adds editing,
    // so what still has to hold is the part that matters: the import endpoint is
    // the only one the monitor ever calls. Saving must not reach the backend, let
    // alone write the user's workbook. Covered end to end in monitorEdit.test.tsx.
    monitorImport.mockResolvedValue(importedMonitor())
    render(<App />)

    chooseAndImport(monitorFile())

    await within(section()).findByText(/existing monitor loaded/i)
    expect(within(section()).queryByRole('button', { name: /write back|continue session/i })).toBeNull()
    expect(
      within(section()).getByRole('button', { name: /upload monitor excel/i }),
    ).toBeInTheDocument()
  })

  it('shows the preview read-only until the user asks to edit', async () => {
    monitorImport.mockResolvedValue(importedMonitor())
    render(<App />)

    chooseAndImport(monitorFile())
    await waitFor(previewTable)

    // Looking at the file must not turn it into a form.
    expect(within(previewTable()).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(previewTable()).queryByRole('combobox')).not.toBeInTheDocument()
  })
})

describe('a monitoring workbook that cannot be read', () => {
  it('explains a file that is not an Excel file, in plain words', async () => {
    monitorImport.mockRejectedValue(
      new ApiError(
        'This file could not be opened as an Excel file.',
        415,
        'NotExcelError',
        'Check that it is the .xlsx file produced by this application, and that it is not damaged.',
      ),
    )
    render(<App />)

    chooseAndImport(monitorFile('old_report.xlsx'))

    const alert = await within(section()).findByRole('alert')
    expect(alert).toHaveTextContent(/could not be opened as an excel file/i)
    expect(alert).toHaveTextContent(/produced by this application/i)
  })

  it('names the columns a workbook is missing', async () => {
    monitorImport.mockRejectedValue(
      new ApiError(
        'This Excel file is not a monitoring sheet.',
        422,
        'MissingColumnsError',
        'The Summary sheet is missing these required columns: Quantity.',
      ),
    )
    render(<App />)

    chooseAndImport(monitorFile())

    const alert = await within(section()).findByRole('alert')
    expect(alert).toHaveTextContent(/missing these required columns: quantity/i)
  })

  it('explains an empty workbook rather than showing an empty monitor', async () => {
    monitorImport.mockRejectedValue(
      new ApiError(
        'This monitoring sheet has no rows yet.',
        422,
        'EmptySummaryError',
        'The Summary sheet has no rows.',
      ),
    )
    render(<App />)

    chooseAndImport(monitorFile())

    expect(await within(section()).findByRole('alert')).toHaveTextContent(/no rows yet/i)
    expect(within(section()).queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows a readable message when the backend cannot be reached', async () => {
    monitorImport.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<App />)

    chooseAndImport(monitorFile())

    expect(await within(section()).findByRole('alert')).toHaveTextContent(/could not be read/i)
  })

  it('clears the previous error when a new file is chosen', async () => {
    monitorImport.mockRejectedValueOnce(
      new ApiError('This file could not be opened as an Excel file.', 415, 'NotExcelError', 'Damaged.'),
    )
    render(<App />)

    chooseAndImport(monitorFile('first.xlsx'))
    await within(section()).findByRole('alert')

    monitorImport.mockResolvedValueOnce(importedMonitor())
    chooseAndImport(monitorFile('monitoring_sheet.xlsx'))

    await within(section()).findByText(/existing monitor loaded/i)
    expect(within(section()).queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('reading a monitoring workbook', () => {
  it('says it is working instead of leaving the user waiting', async () => {
    let release: (value: ImportedMonitor) => void = () => {}
    monitorImport.mockImplementationOnce(
      () => new Promise<ImportedMonitor>((resolve) => (release = resolve)),
    )
    render(<App />)

    chooseAndImport(monitorFile())

    expect(
      await within(section()).findByText(/reading the monitoring file/i),
    ).toBeInTheDocument()
    expect(within(section()).getByRole('button', { name: /upload monitor excel/i })).toBeDisabled()

    release(importedMonitor())
    await within(section()).findByText(/existing monitor loaded/i)
  })

  it('refuses a second upload while the first is still running', async () => {
    let release: (value: ImportedMonitor) => void = () => {}
    monitorImport.mockImplementationOnce(
      () => new Promise<ImportedMonitor>((resolve) => (release = resolve)),
    )
    render(<App />)

    chooseAndImport(monitorFile('first.xlsx'))
    await within(section()).findByRole('button', { name: /upload monitor excel/i })

    fireEvent.click(within(section()).getByRole('button', { name: /upload monitor excel/i }))
    expect(monitorImport).toHaveBeenCalledTimes(1)

    release(importedMonitor())
    await within(section()).findByText(/existing monitor loaded/i)
  })
})

describe('the imported monitor stays separate from the session', () => {
  it('does not become a session quotation', async () => {
    monitorImport.mockResolvedValue(importedMonitor())
    render(<App />)

    chooseAndImport(monitorFile())

    await within(section()).findByText(/existing monitor loaded/i)
    // The workbook can now be regenerated on its own, so the action exists. What
    // matters here is that opening a file did not turn its rows into quotations
    // queued up in this session.
    expect(
      screen.getByRole('button', { name: /generate consolidated workbook/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('table', { name: /quotations already added/i }),
    ).not.toBeInTheDocument()
  })

  it('continues the numbering from the workbook, rather than restarting at 001', async () => {
    // The workbook has already reached 007. A quotation added to it is the eighth,
    // so it is numbered 008. It is still not a quotation in the session: the rows
    // stay in their own preview, and the workbook is not downloaded or written to.
    monitorImport.mockResolvedValue(
      importedMonitor({ rows: [row({ sequence_number: '007' })], highest_sequence: '007', row_count: 1 }),
    )
    render(<App />)

    chooseAndImport(monitorFile())
    await within(section()).findByText(/existing monitor loaded/i)

    await reachSequenceStep()

    expect(screen.getByLabelText(/sequence number/i)).toHaveValue('008')
  })

  it('survives adding a quotation afterwards without being lost', async () => {
    monitorImport.mockResolvedValue(importedMonitor())
    render(<App />)

    chooseAndImport(monitorFile())
    await within(section()).findByText(/existing monitor loaded/i)

    await reachSequenceStep()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))

    await screen.findByLabelText('Quotation PDF file')
    // Both live on the same screen, and neither has replaced the other.
    expect(within(section()).getByText(/existing monitor loaded/i)).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /quotations already added/i })).toBeInTheDocument()
  })

  it('survives a cancelled draft', async () => {
    monitorImport.mockResolvedValue(importedMonitor())
    render(<App />)

    chooseAndImport(monitorFile())
    await within(section()).findByText(/existing monitor loaded/i)

    await reachSequenceStep()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(within(section()).getByText(/existing monitor loaded/i)).toBeInTheDocument(),
    )
  })

  it('does not disturb the quotation upload section', async () => {
    monitorImport.mockResolvedValue(importedMonitor())
    render(<App />)

    chooseAndImport(monitorFile())

    await within(section()).findByText(/existing monitor loaded/i)
    expect(screen.getByLabelText('Quotation PDF file')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Read quotation' })).toBeInTheDocument()
    expect(parse).not.toHaveBeenCalled()
  })
})
