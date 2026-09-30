/**
 * Types mirroring the backend monitoring contract.
 *
 * These must stay in step with `backend/app/models/monitor.py`. Field names are
 * snake_case because they match the API response one to one, the same rule
 * `types/quotation.ts` follows; the UI converts to whatever shape it prefers.
 *
 * Unlike the quotation types, the fields a person controls by hand *are* here:
 * a monitoring workbook is not being extracted, it is being read back exactly as
 * its owner left it.
 */

import type { SourceInfo } from './quotation'

/**
 * Mirrors `MonitorStatus` in `backend/app/models/monitor.py`.
 *
 * `''` is a real value, not a placeholder: a row can have no status yet, and
 * the user chooses that in Excel rather than the application.
 */
export type MonitorStatus = 'On Hold' | 'Ongoing' | 'Completed' | ''

/** One Summary row, exactly as the workbook stored it. */
export type ImportedMonitorRow = {
  /**
   * Sequence Number as written in the file, e.g. `'001'` or `'007'`.
   *
   * Kept as a string on purpose. A sequence is an identifier, and reading it as
   * a number would turn `007` into `7` and quietly renumber a project.
   */
  sequence_number: string
  client_name: string
  project_name: string
  product_description: string
  /** Quantity for this line item, or null when the cell is empty. */
  quantity: number | null
  unit_of_measurement: string
  /** Installation Schedule, or `''` when the cell is empty. */
  installation_schedule: string
  /** Start Date as the workbook displays it, or null when the cell is empty. */
  start_date: string | null
  status: MonitorStatus
}

/** The rows read from a monitoring workbook by `POST /api/monitor/import`. */
export type ImportedMonitor = {
  rows: ImportedMonitorRow[]
  /**
   * The Sequence Number of the numerically largest row, or null when the
   * workbook holds no rows.
   *
   * Still a string so it can be shown and stored like any other identifier, but
   * it was chosen by comparing the rows as numbers, so a workbook that skipped
   * a value does not hand back the last value that happened to be written last.
   */
  highest_sequence: string | null
  row_count: number
  source_filename: string
}

/** The upload screen's state for the "Continue Existing Monitor" section. */
export type MonitorImportState = {
  /** The file the user picked, before it is uploaded. */
  file: File | null
  /** The workbook that was read successfully, shown as a read-only preview. */
  monitor: ImportedMonitor | null
  /** True while the upload is in flight, so the section can say so. */
  busy: boolean
  /** The message to show when the file could not be read. */
  error: { message: string; detail: string | null } | null
  /** Extra context for the preview, e.g. which file produced it. */
  source: SourceInfo | null
}
