/**
 * The one place a generation request is shaped, tested without React.
 *
 * This builder exists because two different kinds of thing travel to the backend
 * in one request, and they must not be mixed. A quotation is a list of items
 * still to be unpacked; a monitoring row is a finished Summary row the user owns,
 * complete with the schedule, date and status they set in Excel. The two are
 * therefore carried in separate fields and never merged, and this is the only
 * code allowed to decide that.
 *
 * Three rules from AGENTS.md and the backend contract are protected here:
 *
 * - A Sequence Number is an identifier. `"007"` and `"008"` are written as the
 *   strings they are, never padded, renumbered or turned into numbers.
 * - App-only fields never travel. The backend model forbids unknown properties,
 *   and a `fingerprint` or `source` is this application's own bookkeeping.
 * - What was saved is what is sent. The caller passes the confirmed rows
 *   explicitly rather than the builder reaching for some other source, so the
 *   unsaved working copy of the editor can never leak into a workbook.
 */

import { describe, expect, it } from 'vitest'
import { buildConsolidatedRequest } from './consolidatedRequest'
import { createMonitorDraft, monitorDraftReducer } from './monitorDraft'
import type { ImportedMonitorRow } from '../types/monitor'
import type { ConfirmedQuotation, Quotation } from '../types/quotation'

function quotation(overrides: Partial<Quotation> = {}): Quotation {
  return {
    quotation_number: 'QDXB/25/014094/Rev1',
    client_name: 'ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C',
    project_name: 'MBRC 466',
    items: [
      { sr: '1', description: 'Engineered Oak Flooring 15/4 x 120 x 600mm', quantity: 34, unit: 'm2' },
    ],
    ...overrides,
  }
}

function confirmed(
  sequenceNumber: string,
  overrides: Partial<ConfirmedQuotation> = {},
): ConfirmedQuotation {
  return { sequence_number: sequenceNumber, quotation: quotation(), ...overrides }
}

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

describe('with no monitoring workbook open', () => {
  it('sends an empty existing_rows list rather than leaving the field out', () => {
    // The backend defaults the field to empty, so omitting it would also work.
    // Sending it explicitly keeps the payload a complete description of what is
    // being generated, and keeps the shape identical in both cases.
    const request = buildConsolidatedRequest([confirmed('001')], [])

    expect(request.existing_rows).toEqual([])
  })

  it('still sends the quotation that was confirmed', () => {
    const request = buildConsolidatedRequest([confirmed('001')], [])

    expect(request.quotations).toHaveLength(1)
    expect(request.quotations[0].sequence_number).toBe('001')
    expect(request.quotations[0].quotation.project_name).toBe('MBRC 466')
  })
})

describe('with a monitoring workbook open', () => {
  it('sends the saved rows in the order they were saved', () => {
    const saved = [
      monitorRow({ sequence_number: '001', product_description: 'first' }),
      monitorRow({ sequence_number: '007', product_description: 'second' }),
    ]

    const request = buildConsolidatedRequest([confirmed('008')], saved)

    expect(request.existing_rows.map((row) => row.sequence_number)).toEqual(['001', '007'])
  })

  it('sends a saved edit, so a correction the user made reaches the workbook', () => {
    const saved = [monitorRow({ client_name: 'CORRECTED CLIENT NAME' })]

    const request = buildConsolidatedRequest([confirmed('008')], saved)

    expect(request.existing_rows[0].client_name).toBe('CORRECTED CLIENT NAME')
  })

  it('keeps the operational fields the user filled in by hand', () => {
    const saved = [
      monitorRow({
        installation_schedule: '15-20 Nov 2026',
        start_date: '2026-11-15',
        completion_date: '2026-11-20',
        status: 'Completed',
      }),
    ]

    const request = buildConsolidatedRequest([confirmed('008')], saved)

    expect(request.existing_rows[0].installation_schedule).toBe('15-20 Nov 2026')
    expect(request.existing_rows[0].start_date).toBe('2026-11-15')
    expect(request.existing_rows[0].completion_date).toBe('2026-11-20')
    expect(request.existing_rows[0].status).toBe('Completed')
  })
})

describe('choosing which rows are sent', () => {
  it('sends the saved rows and not the working copy being edited', () => {
    // The two are deliberately different. A draft is built from a workbook, an
    // edit is made, and the working copy is what the editor is showing right now
    // -- an unconfirmed change that must not reach a workbook on its own.
    let draft = createMonitorDraft({
      rows: [monitorRow({ client_name: 'ORIGINAL CLIENT' })],
      highest_sequence: '007',
      row_count: 1,
      source_filename: 'monitoring_sheet.xlsx',
    })
    draft = monitorDraftReducer(draft, {
      type: 'row/set',
      index: 0,
      field: 'client_name',
      value: 'UNSAVED EDIT',
    })

    // The caller passes `saved`; the unsaved working copy is not in scope here.
    const request = buildConsolidatedRequest([confirmed('008')], draft.saved)

    expect(request.existing_rows[0].client_name).toBe('ORIGINAL CLIENT')
    expect(request.existing_rows).not.toContainEqual(
      expect.objectContaining({ client_name: 'UNSAVED EDIT' }),
    )
  })

  it('sends the original value after an edit is cancelled', () => {
    // Cancel returns the working copy to the last confirmed state, and that
    // confirmed state is what the request carries. The discarded edit goes with it.
    let draft = createMonitorDraft({
      rows: [monitorRow({ client_name: 'ORIGINAL CLIENT' })],
      highest_sequence: '007',
      row_count: 1,
      source_filename: 'monitoring_sheet.xlsx',
    })
    draft = monitorDraftReducer(draft, {
      type: 'row/set',
      index: 0,
      field: 'client_name',
      value: 'DISCARDED EDIT',
    })
    draft = monitorDraftReducer(draft, { type: 'cancel' })

    const request = buildConsolidatedRequest([confirmed('008')], draft.saved)

    expect(request.existing_rows[0].client_name).toBe('ORIGINAL CLIENT')
  })

  it('sends the corrected value after an edit is saved', () => {
    let draft = createMonitorDraft({
      rows: [monitorRow({ client_name: 'ORIGINAL CLIENT' })],
      highest_sequence: '007',
      row_count: 1,
      source_filename: 'monitoring_sheet.xlsx',
    })
    draft = monitorDraftReducer(draft, {
      type: 'row/set',
      index: 0,
      field: 'client_name',
      value: 'SAVED EDIT',
    })
    draft = monitorDraftReducer(draft, { type: 'save' })

    const request = buildConsolidatedRequest([confirmed('008')], draft.saved)

    expect(request.existing_rows[0].client_name).toBe('SAVED EDIT')
  })
})

describe('stripping app-only fields', () => {
  it('sends only sequence_number and quotation for each quotation', () => {
    // `fingerprint` and `source` are this application's own bookkeeping. The
    // backend model forbids unknown properties, so they must be removed here
    // rather than left for the server to reject.
    const request = buildConsolidatedRequest(
      [
        confirmed('001', {
          fingerprint: 'a1b2c3',
          source: { filename: 'quotation.pdf', page_count: 2, warnings: [] },
        }),
      ],
      [],
    )

    expect(Object.keys(request.quotations[0]).sort()).toEqual(['quotation', 'sequence_number'])
  })

  it('does not mutate the confirmed quotations it was given', () => {
    const original = confirmed('001', { fingerprint: 'a1b2c3' })

    buildConsolidatedRequest([original], [])

    expect(original.fingerprint).toBe('a1b2c3')
  })

  it('keeps every quotation field the backend does accept', () => {
    // Stripping must not reach inside the quotation itself. The client, project,
    // SR# and quantity are all real contract data.
    const request = buildConsolidatedRequest([confirmed('001')], [])

    const sent = request.quotations[0].quotation
    expect(sent.quotation_number).toBe('QDXB/25/014094/Rev1')
    expect(sent.items[0].sr).toBe('1')
    expect(sent.items[0].quantity).toBe(34)
  })
})

describe('keeping the two kinds of row apart', () => {
  it('never adds a monitoring row to the quotations', () => {
    // A monitoring row is a finished Summary row and a quotation is a list of
    // items. Folding one into the other would need a client, a project and a
    // status invented for every existing row, and would drop the three fields
    // that matter most on a row the user maintains.
    const saved = [
      monitorRow({ sequence_number: '001' }),
      monitorRow({ sequence_number: '007' }),
    ]

    const request = buildConsolidatedRequest([confirmed('008')], saved)

    expect(request.quotations).toHaveLength(1)
    expect(request.quotations[0].sequence_number).toBe('008')
    expect(request.quotations[0].quotation.client_name).toBe(
      'ALPAGO DESIGN AND BUILD CONTRACTING L.L.C S.O.C',
    )
  })

  it('does not treat a monitoring row as a quotation field of any kind', () => {
    const request = buildConsolidatedRequest(
      [],
      [monitorRow({ sequence_number: '007' })],
    )

    expect(request.quotations).toEqual([])
  })
})

describe('sequence numbers', () => {
  it('preserves a leading zero on an existing row', () => {
    // `007` is an identifier. Read as a number it becomes `7` and a project is
    // quietly renumbered, which is the exact failure the importer guards against.
    const request = buildConsolidatedRequest([], [monitorRow({ sequence_number: '007' })])

    expect(request.existing_rows[0].sequence_number).toBe('007')
    expect(typeof request.existing_rows[0].sequence_number).toBe('string')
  })

  it('preserves a leading zero on a new quotation', () => {
    const request = buildConsolidatedRequest([confirmed('008')], [])

    expect(request.quotations[0].sequence_number).toBe('008')
    expect(typeof request.quotations[0].sequence_number).toBe('string')
  })

  it('does not renumber, reorder or renumber the two sets against each other', () => {
    // The order the rows are given in is the order they are written in. The
    // generator places existing rows first and the new quotation after them, so
    // sorting here would move rows the user placed on purpose.
    const request = buildConsolidatedRequest(
      [confirmed('008')],
      [
        monitorRow({ sequence_number: '100' }),
        monitorRow({ sequence_number: '009' }),
        monitorRow({ sequence_number: '007' }),
      ],
    )

    expect(request.existing_rows.map((row) => row.sequence_number)).toEqual([
      '100',
      '009',
      '007',
    ])
    expect(request.quotations.map((entry) => entry.sequence_number)).toEqual(['008'])
  })

  it('carries a row that is not a plain number through untouched', () => {
    // A workbook may hold a Sequence Number the application does not understand.
    // The builder must not parse it, and must not let it be rejected here either:
    // the backend decides what a Sequence Number may be.
    const request = buildConsolidatedRequest([], [monitorRow({ sequence_number: 'A-12' })])

    expect(request.existing_rows[0].sequence_number).toBe('A-12')
  })
})

/**
 * The wire contract, held on the frontend side.
 *
 * The backend model forbids unknown properties, so a name that differs here is
 * not a cosmetic mismatch: the request is rejected with a 422 and the workbook is
 * never produced. Nothing catches that at build time, because both sides are
 * typed and the two types are not compared to each other.
 *
 * So the names are pinned. The column list is the ten Summary fields the backend
 * requires in `backend/app/models/monitor.py`, restated here as the expectation
 * rather than derived from a shared file, which is deliberate: if the two lists
 * ever drift, this test is supposed to fail rather than agree with the mistake.
 */
describe('the request the backend receives', () => {
  const BACKEND_ROW_FIELDS = [
    'client_name',
    'completion_date',
    'installation_schedule',
    'product_description',
    'project_name',
    'quantity',
    'sequence_number',
    'start_date',
    'status',
    'unit_of_measurement',
  ]

  it('sends exactly the two field names ConsolidatedWorkbookRequest accepts', () => {
    const request = buildConsolidatedRequest([confirmed('008')], [monitorRow()])

    expect(Object.keys(request).sort()).toEqual(['existing_rows', 'quotations'])
  })

  it('sends exactly the ten fields an imported row is made of', () => {
    const request = buildConsolidatedRequest([], [monitorRow()])

    // The model is `extra="forbid"`, so an eleventh or a misspelled name fails the
    // whole request rather than dropping one field.
    expect(Object.keys(request.existing_rows![0]).sort()).toEqual(BACKEND_ROW_FIELDS)
  })

  it('sends exactly the fields a quotation entry is made of', () => {
    const request = buildConsolidatedRequest([confirmed('008')], [])

    expect(Object.keys(request.quotations[0]).sort()).toEqual(['quotation', 'sequence_number'])
    expect(Object.keys(request.quotations[0].quotation).sort()).toEqual([
      'client_name',
      'items',
      'project_name',
      'quotation_number',
    ])
  })

  it('survives being serialised, which is what actually crosses the wire', () => {
    // A value that only exists on an object until `JSON.stringify` runs would be
    // dropped in transit, so the check is made on the encoded form.
    const body = JSON.parse(
      JSON.stringify(buildConsolidatedRequest([confirmed('008')], [monitorRow({ sequence_number: '007' })])),
    )

    expect(Object.keys(body).sort()).toEqual(['existing_rows', 'quotations'])
    expect(body.existing_rows[0].sequence_number).toBe('007')
    expect(body.quotations[0].sequence_number).toBe('008')
  })
})
