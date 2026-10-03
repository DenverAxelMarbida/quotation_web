/**
 * The rule that turns Installation Schedule, Start Date and Completion Date
 * into a Status.
 *
 * This is the frontend half of one rule. The backend applies the same one when
 * it writes a workbook (`derive_status` in `backend/app/models/monitor.py`), so
 * a row shown in the editor and the same row in Excel cannot disagree. The two
 * are kept as separate plain functions rather than fetched from a shared place
 * because neither side can import the other's language.
 *
 * A Status is not something a person chooses and not something a file supplies:
 * it follows from the three dates. A cell claiming the work is finished while
 * the Completion Date is empty is therefore not an answer this function can
 * produce, however it got there.
 *
 * Rule, in priority order (AGENTS.md sections 6 and 7):
 *
 *   a Completion Date       -> Completed
 *   a Schedule AND a Start  -> Ongoing
 *   anything else           -> On Hold
 *
 * Installation Schedule, Start Date and Completion Date stay under the user's
 * control; only the reading of them is automatic.
 */

import type { MonitorStatus } from '../types/monitor'

/**
 * `''`, `'-'` and whitespace-only text all mean "nothing was set".
 *
 * They are the shapes an empty spreadsheet cell arrives in, and each of them
 * has been mistaken for a value before: a dash is how many sheets show an empty
 * cell, and spaces are what a copy-and-paste leaves behind. Counting any of
 * them as a date would call a job started, or finished, when nobody said so.
 */
function isSet(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false
  const trimmed = value.trim()
  return trimmed !== '' && trimmed !== '-'
}

/** The Status that the three operational fields support, for one row. */
export function deriveStatus(
  installationSchedule: string | null | undefined,
  startDate: string | null | undefined,
  completionDate: string | null | undefined,
): MonitorStatus {
  // The completion date outranks the two before it: once the work is finished,
  // how long it was scheduled for no longer describes its present state.
  if (isSet(completionDate)) return 'Completed'

  // A job that is scheduled and has begun is ongoing. Either one alone is a
  // plan that has not been acted on yet, which is what On Hold means.
  if (isSet(installationSchedule) && isSet(startDate)) return 'Ongoing'

  return 'On Hold'
}
