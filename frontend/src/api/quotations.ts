/**
 * Quotation endpoints.
 *
 * One function per backend route, each returning the shared contract type. This
 * is the only place the UI talks to the API.
 */

import { apiBaseUrl, getJson, postFile } from './client'
import type { 
  ConsolidatedWorkbookRequest, 
  HealthResponse, 
  Quotation, 
  QuotationPreview 
} from '../types/quotation'

/**
 * Upload a quotation PDF and get back structured data plus the list of fields
 * that still need a human to look at them.
 */
export function parseQuotation(file: File, signal?: AbortSignal): Promise<QuotationPreview> {
  return postFile<QuotationPreview>('/api/quotations/parse', file, signal)
}

/**
 * Generate an Excel workbook from confirmed quotation data.
 *
 * The quotation has been reviewed and edited by the user. This returns the
 * raw bytes of a .xlsx workbook ready for download.
 */
export async function generateExcel(
  quotation: Quotation,
  signal?: AbortSignal
): Promise<Blob> {
  const response = await fetch(`${apiBaseUrl()}/api/quotations/generate-excel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quotation),
    signal,
  })

  if (!response.ok) {
    const text = await response.text()
    let payload: unknown = null
    try {
      payload = JSON.parse(text)
    } catch {
      // Not JSON
    }
    // Use the same error handling as the other endpoints
    const error = (payload as { error?: { message?: string } })?.error
    throw new Error(error?.message || 'Failed to generate Excel workbook')
  }

  return response.blob()
}

/**
 * Generate a consolidated Excel workbook from multiple confirmed quotations.
 *
 * Each quotation in the list contributes its line items to the Excel workbook,
 * with all items from a single quotation sharing the same sequence number.
 * The quotations have been reviewed and edited by the user.
 */
export async function generateConsolidatedExcel(
  request: ConsolidatedWorkbookRequest,
  signal?: AbortSignal
): Promise<Blob> {
  const response = await fetch(`${apiBaseUrl()}/api/quotations/generate-consolidated-excel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  })

  if (!response.ok) {
    const text = await response.text()
    let payload: unknown = null
    try {
      payload = JSON.parse(text)
    } catch {
      // Not JSON
    }
    // Use the same error handling as the other endpoints
    const error = (payload as { error?: { message?: string } })?.error
    throw new Error(error?.message || 'Failed to generate consolidated Excel workbook')
  }

  return response.blob()
}

/** Backend connectivity probe. */
export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return getJson<HealthResponse>('/api/health', signal)
}
