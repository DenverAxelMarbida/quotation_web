/**
 * Phase 5C-C: the monitoring workbook can be regenerated on its own.
 *
 * The workbook lives in OneDrive and the mother is the one who maintains it. So
 * the commonest job is not "add a quotation" -- it is "I opened the file,
 * corrected a row, give me the corrected copy back". Requiring a quotation to get
 * a file out of the system would mean inventing work to get a file out of the
 * system, so a monitor with no new quotation is a complete, valid job.
 *
 * Three modes are real work and all three are supported: quotations alone, the
 * monitor alone, and both. Only the fourth -- neither -- is refused, because
 * there would be nothing in the file.
 *
 * The assertion that matters most in this block is which rows are sent. A
 * generation that quietly dropped a correction she had saved would produce a
 * file that looks finished and is wrong, and she has no way of telling.
 *
 * Driven through the real screen like the rest of App.test.tsx; only the network
 * is stubbed.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
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

/** A quotation that reads cleanly apart from one unreadable quantity. */
function referencePreview(): QuotationPreview {
  return {
    quotation: {
      quotation_number: 'QDXB/25/014094/Rev1',
      client_name: 'SAMPLE CLIENT TRADING L.L.C',
      project_name: 'MBRC 466',
      items: [
        { sr: '1', description: 'Engineered Oak Flooring', quantity: 34, unit: 'm2' },
        { sr: '2', description: 'Self-levelling compound', quantity: 122, unit: 'm2' },
      ],
    },
    review: [],
    source: { filename: 'quotation.pdf', page_count: 1, warnings: [] },
  }
}

let fileCounter = 0

function pdfFile(name = 'quote.pdf'): File {
  return new File([`${name}::${fileCounter++}`], name, { type: 'application/pdf' })
}

function monitorRow(overrides: Partial<ImportedMonitorRow> = {}): ImportedMonitorRow {
  return {
    sequence_number: '007',
    client_name: 'SAMPLE CLIENT TRADING L.L.C',
    project_name: 'MBRC 466',
    product_description: 'Engineered Oak Flooring',
    quantity: 34,
    unit_of_measurement: 'm2',
    installation_schedule: '',
    start_date: null,
    status: 'Ongoing',
    ...overrides,
  }
}

/**
 * Two rows, deliberately including a leading zero and a blank schedule, since
 * both are things the file already contains and the regenerated one must too.
 */
function existingWorkbook(): ImportedMonitor {
  const rows = [
    monitorRow(),
    monitorRow({ sequence_number: '001', product_description: 'Vinyl flooring sheet' }),
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

function generateButton() {
  return screen.getByRole('button', { name: /generate consolidated workbook/i })
}

/** Opens the monitoring workbook and waits for it to be shown. */
async function openMonitor(monitor: ImportedMonitor = existingWorkbook()) {
  monitorImport.mockResolvedValue(monitor)
  render(<App />)
  const file = new File([`xlsx::${Math.random()}`], 'monitoring_sheet.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  fireEvent.change(within(monitorSection()).getByLabelText('Monitoring Excel file'), {
    target: { files: [file] },
  })
  fireEvent.click(
    within(monitorSection()).getByRole('button', { name: /upload monitor excel/i }),
  )
  await within(monitorSection()).findByText(/existing monitor loaded/i)
}

/** One editable cell, addressed the way a screen reader would read it. */
function field(rowNumber: number, name: string) {
  return within(monitorSection()).getByLabelText(`${name}, row ${rowNumber}`)
}

/** Opens the editor, which is the only mode with inputs in it. */
async function openEditor() {
  fireEvent.click(within(monitorSection()).getByRole('button', { name: /edit monitor/i }))
  await within(monitorSection()).findByRole('button', { name: /save changes/i })
}

function save() {
  fireEvent.click(within(monitorSection()).getByRole('button', { name: /save changes/i }))
}

function cancel() {
  fireEvent.click(within(monitorSection()).getByRole('button', { name: /^cancel$/i }))
}

/** Opens the editor, corrects the first row's project and saves. */
async function correctProjectAndSave(value: string) {
  await openEditor()
  fireEvent.change(field(1, 'Project Name'), { target: { value } })
  save()
  await within(monitorSection()).findByText(/changes saved/i)
}

/** Adds one quotation to the session. */
async function addQuotation(preview: QuotationPreview = referencePreview(), name = 'quote.pdf') {
  parse.mockResolvedValueOnce(preview)
  fireEvent.change(screen.getByLabelText('Quotation PDF file'), { target: { files: [pdfFile(name)] } })
  fireEvent.click(screen.getByRole('button', { name: 'Read quotation' }))
  await screen.findByRole('heading', { name: /check the quotation details|assign sequence/i, level: 2 })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))
  await screen.findByRole('heading', { name: /assign sequence number/i, level: 2 })
  fireEvent.click(screen.getByRole('button', { name: 'Add to Workbook' }))
  await screen.findByLabelText('Quotation PDF file')
}

/** The single request the screen actually sent. */
function sentRequest() {
  expect(genConsolidated).toHaveBeenCalledTimes(1)
  return genConsolidated.mock.calls[0][0]
}

/**
 * The existing rows the screen sent. Optional in the wire type, because a client
 * predating the field does not send it -- so these tests say out loud that they
 * are asserting on it, rather than quietly tolerating `undefined`.
 */
function sentExistingRows() {
  const rows = sentRequest().existing_rows
  expect(rows).toBeDefined()
  return rows ?? []
}

beforeEach(() => {
  parse.mockReset()
  genExcel.mockReset()
  genConsolidated.mockReset()
  monitorImport.mockReset()
  genExcel.mockResolvedValue(new Blob(['mock excel data']))
  genConsolidated.mockResolvedValue(new Blob(['mock excel data']))
})

describe('regenerating the monitoring workbook', () => {
  it('offers to generate from a monitor alone, with no quotation added', async () => {
    // The whole point. A workbook with rows in it is a complete job, so the
    // action exists whether or not a quotation has been read.
    await openMonitor()

    expect(generateButton()).toBeInTheDocument()
  })

  it('sends no quotations and just the monitor rows', async () => {
    await openMonitor()
    fireEvent.click(generateButton())

    const request = await sentRequest()
    expect(request.quotations).toEqual([])
    expect(request.existing_rows).toHaveLength(2)
  })

  it('keeps the sequence numbers the file already used, leading zeros included', async () => {
    // A sequence is an identifier she hands out and other people quote back.
    // '001' read as a number is 1, and a project is quietly renumbered.
    await openMonitor()
    fireEvent.click(generateButton())

    expect(sentExistingRows().map((row) => row.sequence_number)).toEqual(['007', '001'])
  })

  it('keeps the three fields only she controls', async () => {
    // Schedule, start date and status are hers to set in Excel (AGENTS.md
    // section 6). A regeneration that reset them would erase her own work.
    await openMonitor()
    fireEvent.click(generateButton())

    const row = sentExistingRows()[0]
    expect(row.installation_schedule).toBe('')
    expect(row.start_date).toBeNull()
    expect(row.status).toBe('Ongoing')
  })

  it('leaves the monitor out of the session quotation list', async () => {
    // Existing rows and session quotations are different things. An existing row
    // is a finished Summary row she owns; showing them as quotations waiting to
    // be added would invite her to add them a second time.
    await openMonitor()

    expect(screen.queryByRole('table', { name: /quotations already added/i })).toBeNull()
  })

  it('does not describe a monitor-only job as a session of quotations', async () => {
    // An empty "Session quotations" heading over nothing tells her she still
    // needs to add a quotation, when she does not.
    await openMonitor()

    expect(screen.queryByRole('heading', { name: /session quotations/i })).toBeNull()
  })

  it('offers nothing to generate when there is neither a monitor nor a quotation', async () => {
    render(<App />)

    expect(screen.queryByRole('button', { name: /generate consolidated workbook/i })).toBeNull()
  })

  it('offers nothing to generate when a monitor was opened but holds no rows', async () => {
    // An empty workbook and an absent one are the same job: there is nothing to
    // write, and a button that promises otherwise would produce an empty file.
    monitorImport.mockResolvedValue({
      rows: [],
      highest_sequence: null,
      row_count: 0,
      source_filename: 'empty.xlsx',
    })
    render(<App />)
    const file = new File(['xlsx::empty'], 'empty.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    fireEvent.change(within(monitorSection()).getByLabelText('Monitoring Excel file'), {
      target: { files: [file] },
    })
    fireEvent.click(
      within(monitorSection()).getByRole('button', { name: /upload monitor excel/i }),
    )

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /generate consolidated workbook/i }),
      ).toBeNull(),
    )
  })

  it('refuses to generate while a correction is still unconfirmed', async () => {
    // The Generate button is on the upload screen and the editor is open
    // underneath it, so it can be pressed mid-edit. Generating then would write
    // a file that quietly leaves her correction out, and she would have no way
    // of telling from the file.
    await openMonitor()
    await openEditor()
    fireEvent.change(field(1, 'Project Name'), { target: { value: 'MBRC 466 CORRECTED' } })

    fireEvent.click(generateButton())

    await screen.findByText(/save or cancel your monitor changes/i)
    expect(genConsolidated).not.toHaveBeenCalled()
  })

  it('generates the correction once it is saved', async () => {
    await openMonitor()
    await correctProjectAndSave('MBRC 466 CORRECTED')
    fireEvent.click(generateButton())

    expect(sentExistingRows()[0].project_name).toBe('MBRC 466 CORRECTED')
  })

  it('exports the original rows when a correction is cancelled', async () => {
    // Cancelling means "leave it as it was", so the file comes back as the file
    // rather than as something half-edited.
    await openMonitor()
    await openEditor()
    fireEvent.change(field(1, 'Project Name'), { target: { value: 'DISCARDED' } })
    cancel()

    fireEvent.click(generateButton())

    expect(sentExistingRows()[0].project_name).toBe('MBRC 466')
  })

  it('adds a quotation to the monitor when both are present', async () => {
    await openMonitor()
    await addQuotation()
    fireEvent.click(generateButton())

    const request = await sentRequest()
    expect(request.existing_rows).toHaveLength(2)
    expect(request.quotations).toHaveLength(1)
    expect(request.quotations[0].sequence_number).toBe('008')
  })

  it('still generates from quotations alone when no workbook was opened', async () => {
    // The original workflow, unchanged.
    render(<App />)
    await addQuotation()
    fireEvent.click(generateButton())

    const request = await sentRequest()
    expect(request.quotations).toHaveLength(1)
    expect(request.existing_rows).toEqual([])
  })

  it('reports a monitor-only export without claiming anything was combined', async () => {
    // "0 quotations containing 0 line items have been combined" describes a job
    // that did not happen, and it is the only thing the user reads to confirm
    // the right file was made.
    await openMonitor()
    fireEvent.click(generateButton())

    await screen.findByRole('heading', { name: /excel file generated/i })
    expect(screen.getByText(/existing monitor has been exported/i)).toBeInTheDocument()
    expect(screen.queryByText(/containing/i)).toBeNull()
  })

  it('reports a combined export as combined', async () => {
    await openMonitor()
    await addQuotation()
    fireEvent.click(generateButton())

    await screen.findByRole('heading', { name: /excel file generated/i })
    expect(screen.getByText(/existing monitor and new quotations/i)).toBeInTheDocument()
  })

  it('warns that a regenerated workbook keeps only the monitoring fields', async () => {
    // The application rebuilds the 9-column Summary sheet rather than editing the
    // file in place, so anything else the office keeps in that workbook would be
    // missing from the copy. That is a deliberate design choice, not a bug, but
    // the user is the one saving over the file in OneDrive and has to be told.
    await openMonitor()

    expect(
      screen.getByText(/may not be preserved|not be preserved/i),
    ).toBeInTheDocument()
  })

  it('keeps the original wording for a quotations-only export', async () => {
    render(<App />)
    await addQuotation()
    fireEvent.click(generateButton())

    await screen.findByRole('heading', { name: /excel file generated/i })
    expect(screen.getByText(/have been combined into a single workbook/i)).toBeInTheDocument()
  })

  it('keeps the monitor loaded after a monitor-only export', async () => {
    // "Start another quotation" returns her to the upload screen. If the workbook
    // had been dropped, the next export would quietly be quotations only.
    await openMonitor()
    fireEvent.click(generateButton())
    await screen.findByRole('heading', { name: /excel file generated/i })

    fireEvent.click(screen.getByRole('button', { name: /start another quotation/i }))

    expect(await screen.findByText(/existing monitor loaded/i)).toBeInTheDocument()
    expect(generateButton()).toBeInTheDocument()
  })

  it('clears the quotations but keeps the monitor when the session is cleared', async () => {
    // "Clear session" means the quotations she added in this session. The
    // workbook she opened is not hers to discard from a button labelled "clear",
    // and dropping it would silently change what the next export contains.
    await openMonitor()
    await addQuotation()
    fireEvent.click(generateButton())
    await screen.findByRole('heading', { name: /excel file generated/i })

    fireEvent.click(screen.getByRole('button', { name: /clear session/i }))
    fireEvent.click(
      within(screen.getByRole('group')).getByRole('button', { name: /clear session/i }),
    )

    await waitFor(() =>
      expect(
        screen.queryByRole('table', { name: /quotations already added/i }),
      ).toBeNull(),
    )
    expect(screen.getByText(/existing monitor loaded/i)).toBeInTheDocument()
  })
})
