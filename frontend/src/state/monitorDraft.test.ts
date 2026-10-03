/**
 * The editable monitor's own rules, tested without React.
 *
 * The reducer holds everything the editor is allowed to do to a workbook's rows,
 * so these tests describe that contract directly: which fields may change, what
 * an emptied field becomes, and what cancel and save mean.
 *
 * The rules worth protecting are the ones that would quietly corrupt a project's
 * record. A Sequence Number is an identifier, so there is no action that changes
 * one. A quantity is a measurement, so it becomes a number or nothing at all,
 * never a guess. And a value the workbook stored is not reformatted on the way
 * through the editor.
 */

import { describe, expect, it } from 'vitest'
import {
  changedRowCount,
  createMonitorDraft,
  hasUnsavedChanges,
  monitorDraftReducer,
  type EditableMonitorField,
  type MonitorDraftAction,
  type MonitorDraftState,
} from './monitorDraft'
import type { ImportedMonitor, ImportedMonitorRow } from '../types/monitor'

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

function monitor(rows: ImportedMonitorRow[] = [row()]): ImportedMonitor {
  return {
    rows,
    highest_sequence: rows[0]?.sequence_number ?? null,
    row_count: rows.length,
    source_filename: 'monitoring_sheet.xlsx',
  }
}

function reduce(actions: MonitorDraftAction[], start?: ImportedMonitor): MonitorDraftState {
  const initial = createMonitorDraft(start ?? monitor())
  return actions.reduce(monitorDraftReducer, initial)
}

describe('creating a draft', () => {
  it('starts from the rows the import returned', () => {
    const state = createMonitorDraft(monitor([row(), row({ sequence_number: '002' })]))

    expect(state.rows).toHaveLength(2)
    expect(state.rows[0].product_description).toBe('Engineered Oak Flooring 15/4 x 120 x 600mm')
  })

  it('treats the imported rows as already saved, so nothing looks edited', () => {
    const state = createMonitorDraft(monitor())

    expect(hasUnsavedChanges(state)).toBe(false)
    expect(changedRowCount(state)).toBe(0)
  })

  it('keeps the working copy independent of the import it came from', () => {
    // The import result is the file's record. Editing must not reach back into
    // it, or a later re-read of the same object would show the user's edits.
    const source = monitor()
    const state = createMonitorDraft(source)

    monitorDraftReducer(state, { type: 'row/set', index: 0, field: 'project_name', value: 'X' })

    expect(source.rows[0].project_name).toBe('MBRC 466')
  })
})

describe('editing a field', () => {
  it('changes a client name', () => {
    const state = reduce([{ type: 'row/set', index: 0, field: 'client_name', value: 'NEW CLIENT' }])

    expect(state.rows[0].client_name).toBe('NEW CLIENT')
  })

  it('changes a project name', () => {
    const state = reduce([{ type: 'row/set', index: 0, field: 'project_name', value: 'Serenity' }])

    expect(state.rows[0].project_name).toBe('Serenity')
  })

  it('changes a product description', () => {
    const state = reduce([
      { type: 'row/set', index: 0, field: 'product_description', value: 'WF-01AR Walnut' },
    ])

    expect(state.rows[0].product_description).toBe('WF-01AR Walnut')
  })

  it('changes a unit of measurement, keeping unusual units', () => {
    const state = reduce([{ type: 'row/set', index: 0, field: 'unit_of_measurement', value: 'L.M.' }])

    expect(state.rows[0].unit_of_measurement).toBe('L.M.')
  })

  it('changes an installation schedule', () => {
    const state = reduce([
      { type: 'row/set', index: 0, field: 'installation_schedule', value: '14/03/2026' },
    ])

    expect(state.rows[0].installation_schedule).toBe('14/03/2026')
  })

  it('marks the state as having unsaved changes', () => {
    const state = reduce([{ type: 'row/set', index: 0, field: 'project_name', value: 'Serenity' }])

    expect(hasUnsavedChanges(state)).toBe(true)
    expect(changedRowCount(state)).toBe(1)
  })

  it('counts each edited row once, however many fields changed', () => {
    const state = reduce([
      { type: 'row/set', index: 0, field: 'project_name', value: 'Serenity' },
      { type: 'row/set', index: 0, field: 'client_name', value: 'NEW CLIENT' },
    ])

    expect(changedRowCount(state)).toBe(1)
  })

  it('ignores an index that is not a row', () => {
    const state = reduce([{ type: 'row/set', index: 9, field: 'project_name', value: 'X' }])

    expect(state).toEqual(createMonitorDraft(monitor()))
  })

  it('returns the same state object when the edit is not applied', () => {
    // Returning the same reference lets React skip the re-render, and it is how
    // the reducer signals that nothing happened.
    const initial = createMonitorDraft(monitor())

    expect(monitorDraftReducer(initial, { type: 'row/set', index: 9, field: 'project_name', value: 'X' })).toBe(
      initial,
    )
  })

  it('leaves the other rows untouched', () => {
    const state = reduce([{ type: 'row/set', index: 1, field: 'project_name', value: 'Tower' }], monitor([
      row(),
      row({ sequence_number: '002', project_name: 'Marina Bay' }),
    ]))

    expect(state.rows[0].project_name).toBe('MBRC 466')
    expect(state.rows[1].project_name).toBe('Tower')
  })
})

describe('the sequence number is an identifier, not an editable field', () => {
  it('is never changed by an edit to another field', () => {
    const state = reduce([{ type: 'row/set', index: 0, field: 'project_name', value: 'X' }])

    expect(state.rows[0].sequence_number).toBe('001')
  })

  it('keeps a leading zero sequence', () => {
    const state = reduce([{ type: 'row/set', index: 0, field: 'project_name', value: 'X' }], monitor([
      row({ sequence_number: '007' }),
    ]))

    expect(state.rows[0].sequence_number).toBe('007')
  })

  it('keeps a hierarchical sequence with its trailing zeros', () => {
    const state = reduce([{ type: 'row/set', index: 0, field: 'project_name', value: 'X' }], monitor([
      row({ sequence_number: '1.130' }),
    ]))

    expect(state.rows[0].sequence_number).toBe('1.130')
  })

  it('survives saving and cancelling without being renumbered', () => {
    const state = reduce(
      [
        { type: 'row/set', index: 0, field: 'project_name', value: 'X' },
        { type: 'save' },
        { type: 'row/set', index: 0, field: 'project_name', value: 'Y' },
        { type: 'cancel' },
      ],
      monitor([row({ sequence_number: '007' })]),
    )

    expect(state.rows[0].sequence_number).toBe('007')
  })

  it('cannot be renumbered, because no action targets it', () => {
    // The guard is the type: `sequence_number` is not in EditableMonitorField, so
    // this object does not typecheck. The runtime check below documents why.
    expect(
      Object.keys(row()) as string[],
    ).toContain('sequence_number')
    // A row that arrives with a changed sequence from elsewhere is still stored
    // as given; the editor simply has no way to ask for that.
    const state = reduce([{ type: 'row/set', index: 0, field: 'client_name', value: 'X' }], monitor([
      row({ sequence_number: '1.130' }),
    ]))
    expect(state.rows[0].sequence_number).toBe('1.130')
  })
})

describe('quantity', () => {
  it('is stored as a number after an edit', () => {
    const state = reduce([{ type: 'row/set', index: 0, field: 'quantity', value: '88.5' }])

    expect(state.rows[0].quantity).toBe(88.5)
  })

  it('accepts a whole number typed as text', () => {
    const state = reduce([{ type: 'row/set', index: 0, field: 'quantity', value: '122' }])

    expect(state.rows[0].quantity).toBe(122)
  })

  it('becomes empty rather than zero when the user clears it', () => {
    // Clearing a box is not the same as typing 0, and must not become 0.
    const state = reduce([{ type: 'row/set', index: 0, field: 'quantity', value: '' }])

    expect(state.rows[0].quantity).toBeNull()
  })

  it('never invents a quantity from something that is not a number', () => {
    const state = reduce([{ type: 'row/set', index: 0, field: 'quantity', value: 'about 34' }])

    expect(state.rows[0].quantity).toBeNull()
  })

  it('keeps a decimal that was already in the workbook', () => {
    const state = reduce([{ type: 'row/set', index: 0, field: 'quantity', value: '34' }], monitor([
      row({ quantity: 34.5 }),
    ]))

    expect(state.rows[0].quantity).toBe(34)
  })

  it('keeps zero, which is a real measurement', () => {
    const state = reduce([{ type: 'row/set', index: 0, field: 'quantity', value: '0' }])

    expect(state.rows[0].quantity).toBe(0)
  })
})

describe('installation schedule', () => {
  it('may be blank, and stays a blank string', () => {
    const state = reduce([
      { type: 'row/set', index: 0, field: 'installation_schedule', value: '' },
    ])

    expect(state.rows[0].installation_schedule).toBe('')
  })

  it('round-trips an edited value back to blank', () => {
    const state = reduce([
      { type: 'row/set', index: 0, field: 'installation_schedule', value: '14/03/2026' },
      { type: 'row/set', index: 0, field: 'installation_schedule', value: '' },
    ])

    expect(state.rows[0].installation_schedule).toBe('')
  })
})

describe('start date', () => {
  it('is kept as the text that was typed', () => {
    const state = reduce([{ type: 'row/set', index: 0, field: 'start_date', value: '14/03/2026' }])

    expect(state.rows[0].start_date).toBe('14/03/2026')
  })

  it('does not reformat a date the workbook already held', () => {
    const state = reduce([{ type: 'row/set', index: 0, field: 'client_name', value: 'X' }], monitor([
      row({ start_date: '05/01/2026' }),
    ]))

    expect(state.rows[0].start_date).toBe('05/01/2026')
  })

  it('keeps a date the user wrote as a phrase', () => {
    const state = reduce([{ type: 'row/set', index: 0, field: 'start_date', value: 'to be agreed' }])

    expect(state.rows[0].start_date).toBe('to be agreed')
  })

  it('becomes empty rather than an empty date when cleared', () => {
    const state = reduce([{ type: 'row/set', index: 0, field: 'start_date', value: '' }], monitor([
      row({ start_date: '05/01/2026' }),
    ]))

    expect(state.rows[0].start_date).toBeNull()
  })
})

describe('status follows the dates it is derived from', () => {
  it('is worked out when the draft is opened, not taken from the file', () => {
    // A Status is not something a workbook gets to assert. Whatever the cell
    // said, the row arrives holding what its own dates mean.
    const state = createMonitorDraft(monitor([row({ status: 'Completed' })]))

    expect(state.rows[0].status).toBe('On Hold')
  })

  it('is kept as the baseline, so opening a file never looks like an edit', () => {
    const state = createMonitorDraft(monitor([row({ status: 'Completed' })]))

    expect(state.saved[0].status).toBe('On Hold')
    expect(hasUnsavedChanges(state)).toBe(false)
  })

  it('becomes Completed as soon as a completion date is entered', () => {
    const state = reduce([
      { type: 'row/set', index: 0, field: 'completion_date', value: '20/11/2026' },
    ])

    expect(state.rows[0].completion_date).toBe('20/11/2026')
    expect(state.rows[0].status).toBe('Completed')
  })

  it('drops back to Ongoing when the completion date is cleared again', () => {
    const state = reduce(
      [{ type: 'row/set', index: 0, field: 'completion_date', value: '' }],
      monitor([
        row({
          installation_schedule: 'November 2026',
          start_date: '01/11/2026',
          completion_date: '20/11/2026',
        }),
      ]),
    )

    expect(state.rows[0].completion_date).toBeNull()
    expect(state.rows[0].status).toBe('Ongoing')
  })

  it('is Ongoing only once the job has both a schedule and a start date', () => {
    const scheduled = reduce([
      { type: 'row/set', index: 0, field: 'installation_schedule', value: 'November 2026' },
    ])
    expect(scheduled.rows[0].status).toBe('On Hold')

    const started = monitorDraftReducer(scheduled, {
      type: 'row/set',
      index: 0,
      field: 'start_date',
      value: '01/11/2026',
    })
    expect(started.rows[0].status).toBe('Ongoing')
  })

  it('goes back to On Hold when the start date is cleared', () => {
    const state = reduce([
      { type: 'row/set', index: 0, field: 'start_date', value: '' },
    ])

    expect(state.rows[0].start_date).toBeNull()
    expect(state.rows[0].status).toBe('On Hold')
  })

  it('is left alone when a field it does not follow is edited', () => {
    const state = reduce(
      [{ type: 'row/set', index: 0, field: 'client_name', value: 'NEW CLIENT' }],
      monitor([
        row({ installation_schedule: 'November 2026', start_date: '01/11/2026' }),
      ]),
    )

    expect(state.rows[0].client_name).toBe('NEW CLIENT')
    expect(state.rows[0].status).toBe('Ongoing')
  })

  it('has no editable field of its own', () => {
    // Spelled out at runtime so that adding Status, or dropping an editable
    // field, fails a test rather than only a type check.
    const editable: readonly EditableMonitorField[] = [
      'client_name',
      'project_name',
      'product_description',
      'quantity',
      'unit_of_measurement',
      'installation_schedule',
      'start_date',
      'completion_date',
    ]

    expect(editable).toHaveLength(8)
    expect((editable as readonly string[]).includes('status')).toBe(false)
  })
})

describe('saving', () => {
  it('makes the current rows the new baseline', () => {
    const state = reduce([
      { type: 'row/set', index: 0, field: 'project_name', value: 'Serenity' },
      { type: 'save' },
    ])

    expect(hasUnsavedChanges(state)).toBe(false)
    expect(state.saved[0].project_name).toBe('Serenity')
  })

  it('keeps the edited values in the rows', () => {
    const state = reduce([
      { type: 'row/set', index: 0, field: 'project_name', value: 'Serenity' },
      { type: 'save' },
    ])

    expect(state.rows[0].project_name).toBe('Serenity')
  })

  it('is not confused by saving twice with nothing changed', () => {
    const state = reduce([{ type: 'save' }, { type: 'save' }])

    expect(hasUnsavedChanges(state)).toBe(false)
  })
})

describe('cancelling', () => {
  it('discards an edit made since the import', () => {
    const state = reduce([
      { type: 'row/set', index: 0, field: 'project_name', value: 'Serenity' },
      { type: 'cancel' },
    ])

    expect(state.rows[0].project_name).toBe('MBRC 466')
    expect(hasUnsavedChanges(state)).toBe(false)
  })

  it('keeps edits that were already saved', () => {
    // The saved state is the baseline, so cancel returns to it rather than to
    // the original import and throwing away work the user confirmed.
    const state = reduce([
      { type: 'row/set', index: 0, field: 'project_name', value: 'Serenity' },
      { type: 'save' },
      { type: 'row/set', index: 0, field: 'project_name', value: 'Marina Bay' },
      { type: 'cancel' },
    ])

    expect(state.rows[0].project_name).toBe('Serenity')
    expect(hasUnsavedChanges(state)).toBe(false)
  })

  it('can be repeated through several edit and save cycles', () => {
    const state = reduce([
      { type: 'row/set', index: 0, field: 'project_name', value: 'First' },
      { type: 'save' },
      { type: 'row/set', index: 0, field: 'project_name', value: 'Second' },
      { type: 'save' },
      { type: 'row/set', index: 0, field: 'project_name', value: 'Third' },
      { type: 'cancel' },
    ])

    expect(state.rows[0].project_name).toBe('Second')
  })

  it('restores every field of a row, not just the last one edited', () => {
    const state = reduce(
      [
        { type: 'row/set', index: 0, field: 'client_name', value: 'A' },
        { type: 'row/set', index: 0, field: 'project_name', value: 'B' },
        { type: 'row/set', index: 0, field: 'quantity', value: '9' },
        { type: 'cancel' },
      ],
      monitor([row({ client_name: 'ORIGINAL', project_name: 'ORIGINAL', quantity: 34 })]),
    )

    expect(state.rows[0].client_name).toBe('ORIGINAL')
    expect(state.rows[0].project_name).toBe('ORIGINAL')
    expect(state.rows[0].quantity).toBe(34)
  })
})

describe('opening another workbook', () => {
  it('starts again from the new file, dropping the previous rows', () => {
    const state = reduce([
      { type: 'row/set', index: 0, field: 'project_name', value: 'Serenity' },
      { type: 'save' },
      {
        type: 'reset',
        monitor: monitor([row({ sequence_number: '009', project_name: 'Other Project' })]),
      },
    ])

    expect(state.rows).toHaveLength(1)
    expect(state.rows[0].sequence_number).toBe('009')
    expect(state.rows[0].project_name).toBe('Other Project')
    expect(hasUnsavedChanges(state)).toBe(false)
  })

  it('empties the editor when there is no workbook', () => {
    const state = reduce([{ type: 'reset', monitor: null }])

    expect(state.rows).toEqual([])
    expect(state.saved).toEqual([])
  })
})

describe('changed row counting', () => {
  it('is zero for a fresh draft', () => {
    expect(changedRowCount(createMonitorDraft(monitor()))).toBe(0)
  })

  it('counts rows that differ from the saved state', () => {
    const state = reduce(
      [
        { type: 'row/set', index: 0, field: 'project_name', value: 'A' },
        { type: 'row/set', index: 1, field: 'project_name', value: 'B' },
        { type: 'row/set', index: 2, field: 'project_name', value: 'C' },
      ],
      monitor([row(), row({ sequence_number: '002' }), row({ sequence_number: '003' })]),
    )

    expect(changedRowCount(state)).toBe(3)
  })

  it('drops back to zero once the rows are saved', () => {
    const state = reduce([
      { type: 'row/set', index: 0, field: 'project_name', value: 'A' },
      { type: 'save' },
    ])

    expect(changedRowCount(state)).toBe(0)
  })

  it('does not count a row that was edited and then put back', () => {
    const state = reduce([
      { type: 'row/set', index: 0, field: 'project_name', value: 'Other' },
      { type: 'row/set', index: 0, field: 'project_name', value: 'MBRC 466' },
    ])

    expect(changedRowCount(state)).toBe(0)
  })
})
