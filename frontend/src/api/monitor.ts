/**
 * Monitoring endpoints.
 *
 * Separate from `api/quotations.ts` because reading an existing monitoring
 * workbook is a different job from extracting a new quotation: the user already
 * owns this file, and nothing here writes to it.
 */

import { postFile } from './client'
import type { ImportedMonitor } from '../types/monitor'

/**
 * Upload a monitoring .xlsx and get back the rows it contains.
 *
 * The backend checks that the file really is a monitoring sheet before answering,
 * so a successful result can be shown to the user as a faithful preview. A
 * failure arrives as an `ApiError` whose message is written for a non-technical
 * reader; the upload screen shows it as it is.
 */
export function importMonitor(file: File, signal?: AbortSignal): Promise<ImportedMonitor> {
  return postFile<ImportedMonitor>('/api/monitor/import', file, signal)
}
