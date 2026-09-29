import { describe, expect, it, vi } from 'vitest'
import { ApiError, apiBaseUrl, getJson, postFile } from './client'
import { fetchHealth, parseQuotation } from './quotations'
import type { QuotationPreview } from '../types/quotation'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('client', () => {
  it('reads the base url from the environment', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com/')
    expect(apiBaseUrl()).toBe('https://api.example.com')
    vi.unstubAllEnvs()
  })

  it('returns parsed json on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' })))

    await expect(getJson<{ status: string }>('/api/health')).resolves.toEqual({ status: 'ok' })
    vi.unstubAllGlobals()
  })

  it('turns the backend error envelope into an ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'UnsupportedDocumentError',
              message: 'This file could not be read as a quotation PDF.',
              detail: 'Upload the original quotation PDF exported from the ERP.',
            },
          },
          415,
        ),
      ),
    )

    const error = await getJson('/api/anything').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(415)
    expect((error as ApiError).code).toBe('UnsupportedDocumentError')
    expect((error as ApiError).message).toBe('This file could not be read as a quotation PDF.')
    vi.unstubAllGlobals()
  })

  it('falls back to a friendly message when the body is not the envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))

    const error = await getJson('/api/anything').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toBe('Something went wrong. Please try again.')
    vi.unstubAllGlobals()
  })

  it('sends the pdf as multipart form data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    const file = new File(['%PDF-1.4'], 'quote.pdf', { type: 'application/pdf' })
    await postFile('/api/quotations/parse', file)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:8000/api/quotations/parse')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toBe(file)
    vi.unstubAllGlobals()
  })
})

describe('quotation endpoints', () => {
  it('parses a quotation and returns the preview contract', async () => {
    const payload: QuotationPreview = {
      quotation: {
        quotation_number: 'Q-1',
        client_name: 'ACME',
        project_name: null,
        items: [{ sr: '1', description: 'flooring', quantity: 30, unit: 'm2' }],
      },
      review: [{ field: 'project_name', reason: 'missing', message: 'not found' }],
      source: { filename: 'quote.pdf', page_count: 1, warnings: [] },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(payload)))

    const file = new File(['%PDF-1.4'], 'quote.pdf', { type: 'application/pdf' })
    const result = await parseQuotation(file)

    expect(result.quotation.quotation_number).toBe('Q-1')
    expect(result.review[0].field).toBe('project_name')
    vi.unstubAllGlobals()
  })

  it('checks backend health', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'ok', version: '0.1.0' })))

    await expect(fetchHealth()).resolves.toEqual({ status: 'ok', version: '0.1.0' })
    vi.unstubAllGlobals()
  })
})
