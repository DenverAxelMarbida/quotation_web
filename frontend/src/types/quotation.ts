/**
 * Types mirroring the backend quotation contract.
 *
 * These must stay in step with `backend/app/models`. Field names are snake_case
 * because they match the API response one to one; only this file and the API
 * client deal in them, and the UI converts to whatever shape it prefers.
 *
 * Nothing here models sequence number, installation schedule, start date or
 * status. Those are human-controlled and never extracted (AGENTS.md section 6).
 *
 * `ImportedMonitorRow` is imported from `./monitor` rather than restated here.
 * A monitoring row is read back from a file the user already maintains, so its
 * shape is the same one the editor, the importer and the backend all use, and a
 * second copy here could drift from them.
 */

import type { ImportedMonitorRow } from './monitor'

export type QuotationItem = {
  /**
   * SR# exactly as the ERP printed it, kept as text.
   *
   * It is an identifier, not a quantity: hierarchical numbers such as `1.1` or
   * `9.133` lose their trailing zeros if they are read as numbers, so `1.130`
   * would arrive as `1.13`. Mirrors `QuotationItem.sr` in
   * `backend/app/models/quotation.py`.
   */
  sr: string | null
  description: string
  quantity: number | null
  unit: string | null
}

export type Quotation = {
  quotation_number: string | null
  client_name: string | null
  project_name: string | null
  items: QuotationItem[]
}

/** Mirrors `ReviewReason` in `backend/app/models/review.py`. */
export type ReviewReason = 'missing' | 'unconfident' | 'inconsistent'

/** A field the parser could not read with confidence. */
export type ReviewFlag = {
  /** Path of the field, e.g. `client_name` or `items[2].quantity`. */
  field: string
  reason: ReviewReason
  message: string
}

export type SourceInfo = {
  filename: string
  page_count: number
  warnings: string[]
}

/** The editable preview returned by `POST /api/quotations/parse`. */
export type QuotationPreview = {
  quotation: Quotation
  review: ReviewFlag[]
  source: SourceInfo
}

export type HealthResponse = {
  status: string
  version: string
}

/** Header fields a person may correct on the review screen. */
export type HeaderField = 'quotation_number' | 'client_name' | 'project_name'

/** Line-item fields a person may correct on the review screen. */
export type ItemField = 'sr' | 'description' | 'quantity' | 'unit'

/** A confirmed quotation with its manually assigned sequence number. */
export type ConfirmedQuotation = {
  sequence_number: string
  quotation: Quotation
  /**
   * Content fingerprint of the source PDF, used only for same-file duplicate
   * detection within a session. Never sent to the backend.
   */
  fingerprint?: string
  /**
   * Where the quotation was read from, kept so the session preview can show the
   * same source line as the review screen. Never sent to the backend.
   */
  source?: SourceInfo
}

/**
 * Request to generate a consolidated Excel workbook.
 *
 * Two kinds of row travel together, in separate fields. `quotations` are the
 * ones added in this session, each still to be unpacked into Excel rows.
 * `existing_rows` are the Summary rows of a monitoring workbook the user
 * already opened, which are already finished and are written out as they stand.
 *
 * Both mirror `ConsolidatedWorkbookRequest` in `backend/app/models/workbook.py`.
 * `existing_rows` is optional here only because a caller may omit it; it is
 * always sent as a list, empty when no workbook has been opened.
 */
export type ConsolidatedWorkbookRequest = {
  quotations: ConfirmedQuotation[]
  existing_rows?: ImportedMonitorRow[]
}
