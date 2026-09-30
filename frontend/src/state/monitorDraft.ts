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
 */

import type { ImportedMonitor, ImportedMonitorRow, MonitorStatus } from '../types/monitor'

/**
 * The cells a person may change.
 *
 * `sequence_number` is deliberately absent. It is the identifier that ties a row
 * to a quotation, and Phase 5B does not renumber anything, so excluding it here
 * makes it non-editable by construction rather than by hiding a control.
 */
export type EditableMonitorField =
  | 'client_name'
  | 'project_name'
  | 'product_description'
  | 'quantity'
  | 'unit_of_measurement'
  | 'installation_schedule'
  | 'start_date'
  | 'status'

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

/** The status values the workbook's dropdown offers, plus leaving it blank. */
const ALLOWED_STATUSES: readonly MonitorStatus[] = ['On Hold', 'Ongoing', 'Completed', '']

export function createMonitorDraft(monitor: ImportedMonitor | null): MonitorDraftState {
  // Copied row by row, so editing one row cannot reach the object the import
  // returned and a later re-read still sees the file's own values.
  const rows = (monitor?.rows ?? []).map((row) => ({ ...row }))
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

/** `null` for anything outside the workbook's own list, which is then ignored. */
function toStatus(value: string): MonitorStatus | null {
  return (ALLOWED_STATUSES as readonly string[]).includes(value) ? (value as MonitorStatus) : null
}

function setField(
  row: ImportedMonitorRow,
  field: EditableMonitorField,
  value: string,
): ImportedMonitorRow {
  switch (field) {
    case 'client_name':
    case 'project_name':
    case 'product_description':
    case 'unit_of_measurement':
    case 'installation_schedule':
      // Kept as typed, including an empty string. A blank here is a real state
      // for a workbook that has not been scheduled yet.
      return { ...row, [field]: value }
    case 'quantity':
      return { ...row, quantity: toQuantity(value) }
    case 'start_date':
      // Stored as the text it is. `null` is how the importer represents an empty
      // cell, so clearing the box round-trips back to exactly that.
      return { ...row, start_date: value === '' ? null : value }
    case 'status': {
      const status = toStatus(value)
      // The dropdown cannot offer anything else, so this only guards the reducer
      // being called from somewhere else. An unknown value is ignored rather
      // than stored, because the workbook's own list is the contract.
      if (status === null) return row
      return { ...row, status }
    }
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
