/**
 * The one place a generation request is shaped.
 *
 * A request carries two different kinds of thing, and the point of this file is
 * that they stay apart:
 *
 *   quotations      the quotations added in this session, each still to be
 *                   unpacked into one Excel row per line item.
 *   existing_rows   the Summary rows of a monitoring workbook the user already
 *                   opened. These are finished rows, not quotations. They carry
 *                   the Installation Schedule, Start Date and Status their owner
 *                   set in Excel, and they are written out exactly as they stand.
 *
 * They are never merged. Turning a monitoring row into a quotation would mean
 * inventing a client, a project and a blank status for every row the user is
 * maintaining, and discarding the three fields that matter most on them. So the
 * rows are passed through whole, in the order given, and the two lists travel in
 * their own fields.
 *
 * The rows are handed in rather than reached for. Which rows are authoritative is
 * a decision about app state, and it belongs to the caller: the generation
 * boundary passes the last saved rows, so the working copy being edited in the
 * monitor table can never reach a workbook by accident.
 *
 * Two things are deliberately not done here. Sequence Numbers are written as the
 * strings they are -- numbering belongs to one place, and a builder that parsed
 * or padded them could turn `007` into `7`. And nothing is validated or rejected:
 * an unexpected value is the backend's business, and refusing it here would
 * silently drop a row the user can see.
 */

import type { ImportedMonitorRow } from '../types/monitor'
import type {
  ConfirmedQuotation,
  ConsolidatedWorkbookRequest,
} from '../types/quotation'

/**
 * A request as this builder produces it.
 *
 * `ConsolidatedWorkbookRequest.existing_rows` is optional only so that a caller
 * may leave it out. This builder never does, so the field is required here: a
 * consumer of the result does not have to handle it being absent, and the
 * guarantee that the payload always describes the whole file is visible in the
 * type rather than implied by the implementation.
 */
export type BuiltConsolidatedRequest = ConsolidatedWorkbookRequest & {
  existing_rows: ImportedMonitorRow[]
}

/**
 * Build the request for `POST /api/quotations/generate-consolidated-excel`.
 *
 * @param confirmedQuotations the quotations added in this session, in order
 * @param savedMonitorRows    the last saved monitoring rows, in the order the
 *                            workbook held them; empty when none were opened
 */
export function buildConsolidatedRequest(
  confirmedQuotations: ConfirmedQuotation[],
  savedMonitorRows: ImportedMonitorRow[],
): BuiltConsolidatedRequest {
  return {
    // Only `sequence_number` and `quotation` are backend contract. The
    // `fingerprint` and `source` a confirmed quotation carries are this
    // application's own bookkeeping for duplicate detection and the session
    // preview, and the backend model forbids unknown properties, so they are
    // dropped here rather than left for the server to reject.
    quotations: confirmedQuotations.map(({ sequence_number, quotation }) => ({
      sequence_number,
      quotation,
    })),
    // Sent as a list even when empty, so the payload fully describes what will
    // be generated and the shape does not change with or without a workbook.
    existing_rows: savedMonitorRows,
  }
}
