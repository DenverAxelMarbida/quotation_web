/**
 * Editing rules for an imported monitoring workbook.
 *
 * A plain reducer, with no React and no API calls, so the rules can be tested on
 * their own. The editor renders this state; it does not own it.
 *
 * Three levels of truth, and the gap between them is what the user is being asked
 * about when they press Save:
 *
 *   importedMonitor  the rows exactly as the workbook held them. Never mutated,
 *                    and not held here at all: the draft keeps its own copy, so an
 *                    edit can never reach back into the import result.
 *   rows             the working copy being edited right now.
 *   saved            the last state the user confirmed, and the baseline Cancel
 *                    returns to. Cancelling therefore discards the edits made
 *                    since the last save rather than throwing away saved work.
 *
 * Two rules from AGENTS.md shape the field handling:
 *
 * - Nothing is invented. A field the user clears becomes blank, not a default,
 *   and a quantity that is not a number becomes empty rather than zero.
 * - What was read is not reformatted. A Sequence Number is an identifier, and it
 *   is not even in `EditableMonitorField`, so no action can change it; a Start
 *   Date is stored as the text it arrived as.
 *
 * A third rule covers Status, and it works the other way round: a Status is not
 * a field the user sets, so it is not editable either. It is recomputed from the
 * three fields it follows (`state/status.ts`) whenever one of them changes, so
 * what the table shows and what the export will write can never drift apart.
 */

import type { ImportedMonitor, ImportedMonitorRow } from '../types/monitor'
import { deriveStatus } from './status'

/**
 * The cells a person may change.
 *
 * `sequence_number` is deliberately absent. It is the identifier that ties a row
 * to a quotation, and Phase 5B does not renumber anything, so excluding it here
 * makes it non-editable by construction rather than by hiding a control.
 *
 * `status` is absent for a different reason: it is not an input at all. It is
 * worked out from the three fields below it, and offering it for editing would
 * let a row claim something its own dates contradict.
 */
export type EditableMonitorField =
  | 'client_name'
  | 'project_name'
  | 'product_description'
  | 'quantity'
  | 'unit_of_measurement'
  | 'installation_schedule'
  | 'start_date'
  | 'completion_date'

export type MonitorDraftState = {
  /** The working copy: the rows as they stand while being edited. */
  rows: ImportedMonitorRow[]
  /** The last confirmed rows. The baseline for `cancel` and for `hasUnsavedChanges`. */
  saved: ImportedMonitorRow[]
}

export type MonitorDraftAction =
  | { type: 'row/set'; index: number; field: EditableMonitorField; value: string }
  /** Start again from a newly opened workbook, discarding the previous rows. */
  | { type: 'reset'; monitor: ImportedMonitor | null }
  | { type: 'save' }
  | { type: 'cancel' }

/** The three fields the Status is derived from, as row keys. */
const OPERATIONAL_FIELDS = ['installation_schedule', 'start_date', 'completion_date'] as const

/**
 * A copy of one imported row whose Status agrees with its own dates.
 *
 * The backend already derives it, so this is normally a no-op. It exists so the
 * editor can never show a Status that contradicts the dates beside it, whatever
 * the rows it was handed happened to contain -- a workbook saved before this
 * rule existed, or a response from a version that did not apply it.
 */
function withDerivedStatus(row: ImportedMonitorRow): ImportedMonitorRow {
  return {
    ...row,
    status: deriveStatus(row.installation_schedule, row.start_date, row.completion_date),
  }
}

export function createMonitorDraft(monitor: ImportedMonitor | null): MonitorDraftState {
  // Copied row by row, so editing one row cannot reach the object the import
  // returned and a later re-read still sees the file's own values.
  const rows = (monitor?.rows ?? []).map(withDerivedStatus)
  return { rows, saved: rows.map((row) => ({ ...row })) }
}

/** True when the working copy differs from what the user last confirmed. */
export function hasUnsavedChanges(state: MonitorDraftState): boolean {
  return state.rows.some((row, index) => !isSameRow(row, state.saved[index]))
}

/** How many rows differ from the last confirmed state, for the unsaved message. */
export function changedRowCount(state: MonitorDraftState): number {
  return state.rows.filter((row, index) => !isSameRow(row, state.saved[index])).length
}

function isSameRow(a: ImportedMonitorRow | undefined, b: ImportedMonitorRow | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return (
    a.sequence_number === b.sequence_number &&
    a.client_name === b.client_name &&
    a.project_name === b.project_name &&
    a.product_description === b.product_description &&
    a.quantity === b.quantity &&
    a.unit_of_measurement === b.unit_of_measurement &&
    a.installation_schedule === b.installation_schedule &&
    a.start_date === b.start_date &&
    a.completion_date === b.completion_date &&
    a.status === b.status
  )
}

/**
 * A quantity is a measurement, so it is stored as a number.
 *
 * An empty box and something that is not a number both become `null`: there is no
 * quantity to record, and substituting `0` would be a claim the user never made.
 * `0` itself is kept, because a measured zero is a real quantity.
 */
function toQuantity(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/** `null` for an empty cell, so clearing the box round-trips to exactly that. */
function toNullableText(value: string): string | null {
  return value === '' ? null : value
}

/**
 * Write one cell, then bring the Status back into line with the dates.
 *
 * Only an edit to one of the three operational fields can change the answer, so
 * only those trigger the recomputation; editing a client name leaves the Status
 * exactly as it was, because the same dates still say the same thing.
 */
function setField(
  row: ImportedMonitorRow,
  field: EditableMonitorField,
  value: string,
): ImportedMonitorRow {
  const edited = editCell(row, field, value)
  const operational = (OPERATIONAL_FIELDS as readonly string[]).includes(field)
  if (!operational) return edited

  return {
    ...edited,
    status: deriveStatus(edited.installation_schedule, edited.start_date, edited.completion_date),
  }
}

function editCell(
  row: ImportedMonitorRow,
  field: EditableMonitorField,
  value: string,
): ImportedMonitorRow {
  switch (field) {
    case 'client_name':
    case 'project_name':
    case 'product_description':
    case 'unit_of_measurement':
      // Kept as typed, including an empty string. A blank here is a real state
      // for a workbook that has not been scheduled yet.
      return { ...row, [field]: value }
    case 'quantity':
      return { ...row, quantity: toQuantity(value) }
    case 'installation_schedule':
      // Kept as typed too: "to be agreed" is what the user wrote, not a date to
      // be corrected, and a blank means the job has not been scheduled.
      return { ...row, installation_schedule: value }
    case 'start_date':
      // Stored as the text it is. `null` is how the importer represents an empty
      // cell, so clearing the box round-trips back to exactly that.
      return { ...row, start_date: toNullableText(value) }
    case 'completion_date':
      // The same treatment as Start Date, for the same reason: it is a date the
      // user wrote or nothing at all.
      return { ...row, completion_date: toNullableText(value) }
  }
}

export function monitorDraftReducer(
  state: MonitorDraftState,
  action: MonitorDraftAction,
): MonitorDraftState {
  switch (action.type) {
    case 'row/set': {
      const { index, field, value } = action
      const current = state.rows[index]
      if (!current) return state

      const edited = setField(current, field, value)
      return {
        ...state,
        rows: state.rows.map((row, position) => (position === index ? edited : row)),
      }
    }

    case 'reset':
      // A newly opened workbook is its own baseline, so the previous file's rows
      // and edits do not carry over.
      return createMonitorDraft(action.monitor)

    case 'save':
      // The working copy becomes the baseline. Rows are copied so that later
      // edits produce new objects and cannot mutate what was saved.
      return { rows: state.rows, saved: state.rows.map((row) => ({ ...row })) }

    case 'cancel':
      // Back to the last confirmed state, not to the original import, so work
      // the user already saved survives a later cancelled edit.
      return {
        rows: state.saved.map((row) => ({ ...row })),
        saved: state.saved.map((row) => ({ ...row })),
      }
  }
}
