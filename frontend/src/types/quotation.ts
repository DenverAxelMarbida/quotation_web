/**
 * Types mirroring the backend quotation contract.
 *
 * These must stay in step with `backend/app/models`. Field names are snake_case
 * because they match the API response one to one; only this file and the API
 * client deal in them, and the UI converts to whatever shape it prefers.
 *
 * Nothing here models sequence number, installation schedule, start date or
 * status. Those are human-controlled and never extracted (AGENTS.md section 6).
 */

export type QuotationItem = {
  sr: number | null
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

/** Request to generate a consolidated Excel workbook from multiple quotations. */
export type ConsolidatedWorkbookRequest = {
  quotations: ConfirmedQuotation[]
}
