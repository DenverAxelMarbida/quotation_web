/**
 * Phase 5B: correcting an imported monitoring workbook.
 *
 * The mother opens the workbook that already exists, reads the preview, and then
 * finds rows the PDF never carried: a schedule the office moved, a start date
 * that was agreed verbally, a status that is wrong because the work is not moving.
 * This phase lets her fix those, in the browser, without touching the file.
 *
 * Three things must stay true, and most of these tests exist to hold them:
 *
 * - The Sequence Number is an identifier. It is not editable, and it is never
 *   renumbered, padded or converted to a number. Renumbering is continuation
 *   logic that Phase 5B does not have.
 * - Nothing is invented. A cleared box means "not recorded", not zero, and a date
 *   the user typed as a phrase stays a phrase.
 * - The workbook on disk is never touched. Saving is in-memory and says so. The
 *   import endpoint stays the only one the monitor calls, and closing the tab
 *   loses the edits, because a later phase will handle that on purpose.
 *
 * Only the API module is mocked, so these run through the screen a person sees.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
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
    status: 'Ongoing',
    ...overrides,
  }
}

function importedMonitor(overrides: Partial<ImportedMonitor> = {}): ImportedMonitor {
  const rows = overrides.rows ?? [
    row({ product_description: 'Engineered Oak Flooring 15/4 x 120 x 600mm', quantity: 34 }),
    row({ product_description: 'Engineered Oak Flooring 16/4 x 220 x RLmm', quantity: 88 }),
    row({
      sequence_number: '002',
      project_name: 'Marina Bay Tower',
      product_description: 'Self-levelling up to 3mm',
      quantity: 122,
      status: '',
    }),
  ]
  return {
    rows,
    highest_sequence: '002',
    row_count: rows.length,
    source_filename: 'monitoring_sheet.xlsx',
    ...overrides,
  }
}

function quotationPreview(): QuotationPreview {
  return {
    quotation: {
      quotation_number: 'QDXB/25/014094/Rev1',
      client_name: 'ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C',
      project_name: 'MBRC 466',
      items: [{ sr: '1', description: 'Vinyl flooring sheet 2mm', quantity: 200, unit: 'm2' }],
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

function table() {
  return within(section()).getByRole('table', { name: /rows found in the uploaded monitoring workbook/i })
}

function bodyRows() {
  return within(table()).getAllByRole('row').slice(1)
}

async function importWorkbook(monitor: ImportedMonitor = importedMonitor()) {
  monitorImport.mockResolvedValue(monitor)
  render(<App />)
  const file = monitorFile()
  fireEvent.change(within(section()).getByLabelText('Monitoring Excel file'), {
    target: { files: [file] },
  })
  fireEvent.click(within(section()).getByRole('button', { name: /upload monitor excel/i }))
  await within(section()).findByText(/existing monitor loaded/i)
}

/** Puts the editor on screen, which is the only mode with inputs in it. */
async function openEditor(monitor?: ImportedMonitor) {
  await importWorkbook(monitor)
  fireEvent.click(within(section()).getByRole('button', { name: /edit monitor/i }))
  await waitFor(() => expect(within(section()).getByRole('button', { name: /save changes/i })).toBeInTheDocument())
}

/** One editable cell, addressed the way a screen reader would read it. */
function field(rowNumber: number, name: string) {
  return within(section()).getByLabelText(`${name}, row ${rowNumber}`)
}

function type(name: string, rowNumber: number, value: string) {
  fireEvent.change(field(rowNumber, name), { target: { value } })
}

function save() {
  fireEvent.click(within(section()).getByRole('button', { name: /save changes/i }))
}

function cancel() {
  fireEvent.click(within(section()).getByRole('button', { name: /^cancel$/i }))
}

beforeEach(() => {
  monitorImport.mockReset()
  parse.mockReset()
})

describe('entering the editor', () => {
  it('offers editing only after the preview has been seen', async () => {
    await importWorkbook()

    expect(within(section()).getByRole('button', { name: /edit monitor/i })).toBeInTheDocument()
    expect(within(section()).queryByRole('button', { name: /save changes/i })).toBeNull()
  })

  it('shows all nine columns when editing', async () => {
    await openEditor()

    const headers = within(table())
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)
    expect(headers).toEqual([
      'Sequence Number',
      'Client Name',
      'Project Name',
      'Product Description',
      'Quantity',
      'Unit of Measurement',
      'Installation Schedule',
      'Start Date',
      'Status',
    ])
  })

  it('keeps the same number of rows it read from the file', async () => {
    // Adding a row would need a sequence number, which is continuation logic.
    await openEditor()

    expect(bodyRows()).toHaveLength(3)
  })

  it('cannot add or remove a row', async () => {
    await openEditor()

    expect(within(section()).queryByRole('button', { name: /add (a )?row|delete row|remove row/i })).toBeNull()
  })

  it('does not send anything to the backend to open the editor', async () => {
    await importWorkbook()
    const callsAfterImport = monitorImport.mock.calls.length

    fireEvent.click(within(section()).getByRole('button', { name: /edit monitor/i }))

    expect(monitorImport.mock.calls.length).toBe(callsAfterImport)
  })
})

describe('the sequence number is not an editable field', () => {
  it('shows it as text, not a box', async () => {
    await openEditor(
      importedMonitor({ rows: [row({ sequence_number: '001' })], row_count: 1, highest_sequence: '001' }),
    )

    expect(within(table()).queryByLabelText('Sequence Number, row 1')).toBeNull()
    expect(within(table()).getByRole('row', { name: /001/ })).toBeInTheDocument()
  })

  it.each(['001', '007', '1.130'])('keeps %o exactly as imported', async (sequence) => {
    await openEditor(
      importedMonitor({
        rows: [row({ sequence_number: sequence })],
        highest_sequence: sequence,
        row_count: 1,
      }),
    )

    const first = bodyRows()[0]
    expect(within(first).getAllByText(sequence)).not.toHaveLength(0)
    // A bare 7 or 1.13 would mean the identifier had been read as a number.
    expect(within(first).queryByText(sequence.split('.')[0].replace(/^0+(?=\d)/, ''))).toBeNull()
  })

  it('does not renumber rows when another field changes', async () => {
    await openEditor()

    type('Project Name', 1, 'Serenity Residence')
    type('Project Name', 3, 'Marina Bay Phase 2')

    expect(within(bodyRows()[0]).getAllByText('001')).not.toHaveLength(0)
    expect(within(bodyRows()[2]).getAllByText('002')).not.toHaveLength(0)
  })

  it('leaves the sequence untouched after saving', async () => {
    await openEditor(
      importedMonitor({ rows: [row({ sequence_number: '007' })], highest_sequence: '007', row_count: 1 }),
    )

    type('Project Name', 1, 'Serenity Residence')
    save()
    await waitFor(() =>
      expect(within(section()).getByRole('button', { name: /edit monitor/i })).toBeInTheDocument(),
    )
    fireEvent.click(within(section()).getByRole('button', { name: /edit monitor/i }))

    expect(within(bodyRows()[0]).getAllByText('007')).not.toHaveLength(0)
  })
})

describe('the text fields', () => {
  it('edits a client name', async () => {
    await openEditor()
    type('Client Name', 1, 'ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C')
    expect(field(1, 'Client Name')).toHaveValue('ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C')
  })

  it('edits a project name', async () => {
    await openEditor()
    type('Project Name', 1, 'Serenity Residence')
    expect(field(1, 'Project Name')).toHaveValue('Serenity Residence')
  })

  it('edits a product description in a box that grows with the text', async () => {
    // A flooring specification runs to several lines. A one-line box would hide
    // most of what the user needs to read back.
    await openEditor()

    const description = field(1, 'Product Description')
    expect(description.tagName).toBe('TEXTAREA')
    type('Product Description', 1, 'WF-01AR\nEngineered Oak\n600 x 120 x 15')
    expect(description).toHaveValue('WF-01AR\nEngineered Oak\n600 x 120 x 15')
  })

  it('edits a unit of measurement without normalising it', async () => {
    await openEditor()
    type('Unit of Measurement', 1, 'L.M.')
    expect(field(1, 'Unit of Measurement')).toHaveValue('L.M.')
  })

  it('edits an installation schedule', async () => {
    await openEditor()
    type('Installation Schedule', 1, '14/03/2026')
    expect(field(1, 'Installation Schedule')).toHaveValue('14/03/2026')
  })

  it('leaves an installation schedule blank rather than filling one in', async () => {
    await openEditor()
    expect(field(1, 'Installation Schedule')).toHaveValue('')
  })

  it('lets a schedule be set and then cleared again', async () => {
    await openEditor()
    type('Installation Schedule', 1, '14/03/2026')
    type('Installation Schedule', 1, '')
    expect(field(1, 'Installation Schedule')).toHaveValue('')
  })
})

describe('quantity', () => {
  it('shows the number the workbook held', async () => {
    await openEditor()
    expect(field(1, 'Quantity')).toHaveValue(34)
  })

  it('accepts a corrected whole number', async () => {
    await openEditor()
    type('Quantity', 1, '40')
    expect(field(1, 'Quantity')).toHaveValue(40)
  })

  it('accepts a decimal quantity', async () => {
    await openEditor()
    type('Quantity', 1, '34.5')
    expect(field(1, 'Quantity')).toHaveValue(34.5)
  })

  it('treats a cleared box as not recorded, not as zero', async () => {
    await openEditor()
    type('Quantity', 1, '')
    expect(field(1, 'Quantity')).toHaveValue(null)
  })

  it('keeps a quantity of zero, which is a real measurement', async () => {
    await openEditor()
    type('Quantity', 1, '0')
    expect(field(1, 'Quantity')).toHaveValue(0)
  })
})

describe('start date', () => {
  it('shows the date the workbook held, unconverted', async () => {
    await openEditor(
      importedMonitor({
        rows: [row({ start_date: '05/01/2026' })],
        row_count: 1,
        highest_sequence: '001',
      }),
    )

    expect(field(1, 'Start Date')).toHaveValue('05/01/2026')
  })

  it('uses a plain text box, not a date picker that would reform the value', async () => {
    await openEditor()
    const startDate = field(1, 'Start Date')
    expect(startDate).toHaveAttribute('type', 'text')
  })

  it('accepts a date typed by hand', async () => {
    await openEditor()
    type('Start Date', 1, '14/03/2026')
    expect(field(1, 'Start Date')).toHaveValue('14/03/2026')
  })

  it('keeps a date the user wrote as a phrase', async () => {
    // The work has not been agreed a start date yet, and saying so is more honest
    // than a placeholder date that would be read as a commitment.
    await openEditor()
    type('Start Date', 1, 'to be agreed')
    expect(field(1, 'Start Date')).toHaveValue('to be agreed')
  })

  it('leaves a blank start date blank', async () => {
    await openEditor()
    expect(field(1, 'Start Date')).toHaveValue('')
  })
})

describe('status', () => {
  it('offers only the three statuses the workbook knows, plus leaving it blank', async () => {
    await openEditor()

    const options = within(field(1, 'Status')).getAllByRole('option')
    expect(options.map((option) => (option as HTMLOptionElement).value)).toEqual([
      '',
      'On Hold',
      'Ongoing',
      'Completed',
    ])
  })

  it('shows the status the workbook held', async () => {
    await openEditor()
    expect(field(1, 'Status')).toHaveValue('Ongoing')
  })

  it.each(['On Hold', 'Ongoing', 'Completed'])('can be set to %s', async (status) => {
    await openEditor()
    type('Status', 1, status)
    expect(field(1, 'Status')).toHaveValue(status)
  })

  it('can be left blank', async () => {
    await openEditor()
    type('Status', 1, '')
    expect(field(1, 'Status')).toHaveValue('')
  })
})

describe('unsaved changes', () => {
  it('says nothing has been changed yet', async () => {
    await openEditor()
    expect(within(section()).queryByText(/unsaved changes/i)).toBeNull()
  })

  it('warns once a field is edited', async () => {
    await openEditor()
    type('Project Name', 1, 'Serenity Residence')

    expect(await within(section()).findByText(/unsaved changes/i)).toBeInTheDocument()
  })

  it('says how many rows were touched', async () => {
    await openEditor()
    type('Project Name', 1, 'A')
    type('Project Name', 2, 'B')

    expect(await within(section()).findByText(/2 rows changed/i)).toBeInTheDocument()
  })

  it('counts a row once however many of its fields changed', async () => {
    await openEditor()
    type('Project Name', 1, 'A')
    type('Client Name', 1, 'B')

    expect(await within(section()).findByText(/1 row changed/i)).toBeInTheDocument()
  })

  it('stops warning once the changes are saved', async () => {
    await openEditor()
    type('Project Name', 1, 'Serenity Residence')
    save()

    await waitFor(() => expect(within(section()).queryByText(/unsaved changes/i)).toBeNull())
  })

  it('stops warning when an edit is undone by hand', async () => {
    await openEditor()
    type('Project Name', 1, 'Serenity Residence')
    type('Project Name', 1, 'MBRC 466')

    await waitFor(() => expect(within(section()).queryByText(/unsaved changes/i)).toBeNull())
  })
})

describe('saving', () => {
  it('returns to the preview showing the saved values', async () => {
    await openEditor()
    type('Project Name', 1, 'Serenity Residence')
    save()

    await waitFor(() => expect(within(table()).getByText('Serenity Residence')).toBeInTheDocument())
  })

  it('confirms in plain words, and says the file itself is unchanged', async () => {
    await openEditor()
    type('Project Name', 1, 'Serenity Residence')
    save()

    // The user must not leave believing OneDrive now holds this edit.
    const saved = await within(section()).findByText(/changes saved/i)
    expect(saved).toBeInTheDocument()
    expect(within(section()).getByText(/not changed/i)).toBeInTheDocument()
  })

  it('sends nothing to the backend', async () => {
    await openEditor()
    const callsAfterImport = monitorImport.mock.calls.length

    type('Project Name', 1, 'Serenity Residence')
    save()

    await within(section()).findByText(/changes saved/i)
    expect(monitorImport.mock.calls.length).toBe(callsAfterImport)
  })

  it('keeps the saved values when the editor is opened again', async () => {
    await openEditor()
    type('Project Name', 1, 'Serenity Residence')
    type('Quantity', 1, '40')
    save()
    await waitFor(() => expect(within(section()).getByRole('button', { name: /edit monitor/i })).toBeInTheDocument())

    fireEvent.click(within(section()).getByRole('button', { name: /edit monitor/i }))

    expect(field(1, 'Project Name')).toHaveValue('Serenity Residence')
    expect(field(1, 'Quantity')).toHaveValue(40)
    // And it is a clean start, not an edit still waiting to be saved.
    expect(within(section()).queryByText(/unsaved changes/i)).toBeNull()
  })

  it('can be saved repeatedly', async () => {
    await openEditor()
    type('Project Name', 1, 'First')
    save()
    await waitFor(() => expect(within(section()).getByRole('button', { name: /edit monitor/i })).toBeInTheDocument())

    fireEvent.click(within(section()).getByRole('button', { name: /edit monitor/i }))
    await waitFor(() => expect(field(1, 'Project Name')).toBeInTheDocument())
    type('Project Name', 1, 'Second')
    save()

    await waitFor(() => expect(within(table()).getByText('Second')).toBeInTheDocument())
  })
})

describe('cancelling', () => {
  it('discards an edit and returns to the preview', async () => {
    await openEditor()
    type('Project Name', 1, 'Serenity Residence')
    cancel()

    await waitFor(() => expect(within(table()).queryByText('Serenity Residence')).toBeNull())
    expect(within(bodyRows()[0]).getByText('MBRC 466')).toBeInTheDocument()
  })

  it('discards every field edited since the import, not only the last one', async () => {
    await openEditor()
    type('Project Name', 1, 'Serenity Residence')
    type('Quantity', 1, '40')
    type('Status', 1, 'Completed')
    cancel()

    await waitFor(() => expect(within(bodyRows()[0]).getByText('MBRC 466')).toBeInTheDocument())
    expect(within(bodyRows()[0]).getByText('34')).toBeInTheDocument()
    expect(within(bodyRows()[0]).getByText('Ongoing')).toBeInTheDocument()
  })

  it('keeps changes that were already saved', async () => {
    // Saved work is not thrown away by a later cancelled edit.
    await openEditor()
    type('Project Name', 1, 'Serenity Residence')
    save()
    await waitFor(() => expect(within(section()).getByRole('button', { name: /edit monitor/i })).toBeInTheDocument())

    fireEvent.click(within(section()).getByRole('button', { name: /edit monitor/i }))
    await waitFor(() => expect(field(1, 'Project Name')).toBeInTheDocument())
    type('Project Name', 1, 'Serenity Residence Tower')
    cancel()

    await waitFor(() => expect(within(table()).getByText('Serenity Residence')).toBeInTheDocument())
  })

  it('leaves the sequence numbers as they were throughout', async () => {
    await openEditor(
      importedMonitor({
        rows: [row({ sequence_number: '1.130' })],
        highest_sequence: '1.130',
        row_count: 1,
      }),
    )

    type('Project Name', 1, 'Serenity Residence')
    cancel()

    await waitFor(() => expect(within(table()).getByText('MBRC 466')).toBeInTheDocument())
    expect(within(table()).getAllByText('1.130')).not.toHaveLength(0)
  })
})

describe('the edited monitor stays out of the quotation session', () => {
  it('does not become a session quotation', async () => {
    await openEditor()
    type('Project Name', 1, 'Serenity Residence')
    save()

    await within(section()).findByText(/changes saved/i)
    // Re-exporting the workbook is a complete job in its own right, so the action
    // is offered. What matters here is that the corrected rows did not become
    // session quotations waiting to be added a second time.
    expect(screen.getByRole('button', { name: /generate consolidated workbook/i })).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /quotations already added/i })).toBeNull()
  })

  it('does not change the sequence number the next quotation is given', async () => {
    // The workbook has reached 007, so a new quotation is numbered 008. Correcting
    // a project name is content the user owns and must not move that number: the
    // numbering follows the highest Sequence Number the file was opened with,
    // which no edit can reach.
    await openEditor(
      importedMonitor({ rows: [row({ sequence_number: '007' })], highest_sequence: '007', row_count: 1 }),
    )
    type('Project Name', 1, 'Serenity Residence')
    save()
    await within(section()).findByText(/changes saved/i)

    parse.mockResolvedValueOnce(quotationPreview())
    fireEvent.change(screen.getByLabelText('Quotation PDF file'), { target: { files: [pdfFile()] } })
    fireEvent.click(screen.getByRole('button', { name: 'Read quotation' }))
    await screen.findByRole('heading', { name: /check the quotation details/i, level: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quotation' }))

    expect(await screen.findByLabelText(/sequence number/i)).toHaveValue('008')
  })

  it('does not read a PDF while the monitor is being edited', async () => {
    await openEditor()
    type('Project Name', 1, 'Serenity Residence')

    expect(parse).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Quotation PDF file')).toBeInTheDocument()
  })

  it('never sends the workbook to the quotation parser', async () => {
    await openEditor()
    type('Project Name', 1, 'Serenity Residence')
    save()
    await within(section()).findByText(/changes saved/i)

    expect(parse).not.toHaveBeenCalled()
  })
})

describe('a fresh import replaces the edited monitor', () => {
  it('starts again from the newly opened file', async () => {
    await openEditor()
    type('Project Name', 1, 'Serenity Residence')
    save()
    await within(section()).findByText(/changes saved/i)

    monitorImport.mockResolvedValueOnce(
      importedMonitor({
        rows: [row({ project_name: 'Different Project' })],
        row_count: 1,
        highest_sequence: '001',
      }),
    )
    fireEvent.change(within(section()).getByLabelText('Monitoring Excel file'), {
      target: { files: [monitorFile('second.xlsx')] },
    })
    fireEvent.click(within(section()).getByRole('button', { name: /upload monitor excel/i }))

    await waitFor(() => expect(within(table()).getByText('Different Project')).toBeInTheDocument())
    expect(within(table()).queryByText('Serenity Residence')).toBeNull()
  })
})

describe('opening a different workbook', () => {
  it('leaves the file picker available after a workbook is loaded', async () => {
    // The user may have opened the wrong file, and has to be able to try another.
    await importWorkbook()

    expect(within(section()).getByLabelText('Monitoring Excel file')).toBeEnabled()
    expect(within(section()).getByRole('button', { name: /upload monitor excel/i })).toBeEnabled()
  })

  it('will not let a new file discard edits that were not saved', async () => {
    // Opening another workbook resets the rows, so doing it mid-edit would throw
    // the work away without asking. Save or cancel first.
    await openEditor()
    type('Project Name', 1, 'Serenity Residence')

    expect(within(section()).getByLabelText('Monitoring Excel file')).toBeDisabled()
    expect(within(section()).getByRole('button', { name: /upload monitor excel/i })).toBeDisabled()
  })

  it('accepts another file again once the edits are saved', async () => {
    await openEditor()
    type('Project Name', 1, 'Serenity Residence')
    save()

    await waitFor(() =>
      expect(within(section()).getByLabelText('Monitoring Excel file')).toBeEnabled(),
    )
  })
})

describe('the edits do not survive leaving the page', () => {
  it('starts from nothing after a reload, so the file is opened again', async () => {
    // Phase 5B is in-memory only. Reloading is a deliberate reset, and the user is
    // asked for the workbook again rather than shown stale rows.
    const { unmount } = render(<App />)
    const file = monitorFile()
    monitorImport.mockResolvedValue(importedMonitor())
    fireEvent.change(within(section()).getByLabelText('Monitoring Excel file'), {
      target: { files: [file] },
    })
    fireEvent.click(within(section()).getByRole('button', { name: /upload monitor excel/i }))
    await within(section()).findByText(/existing monitor loaded/i)
    fireEvent.click(within(section()).getByRole('button', { name: /edit monitor/i }))
    await waitFor(() => expect(field(1, 'Project Name')).toBeInTheDocument())
    type('Project Name', 1, 'Serenity Residence')
    save()
    await within(section()).findByText(/changes saved/i)
    unmount()

    // Nothing was written to the browser's storage, so a reload cannot restore it.
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)

    render(<App />)
    expect(within(section()).queryByRole('table')).toBeNull()
    expect(within(section()).queryByText(/changes saved/i)).toBeNull()
  })
})
