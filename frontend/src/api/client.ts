/**
 * Low-level HTTP access to the backend.
 *
 * Knows about URLs and error shapes, nothing about quotations. The API returns
 * every failure as `{ error: { code, message, detail } }`, and that message is
 * written to be shown to a non-technical user, so it is passed through as-is.
 */

const DEFAULT_API_BASE_URL = 'http://localhost:8000'

/** Base URL of the FastAPI backend, without a trailing slash. */
export function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL
  return (configured ?? DEFAULT_API_BASE_URL).replace(/\/+$/, '')
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly detail: string | null

  constructor(message: string, status: number, code: string, detail: string | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

function toApiError(status: number, payload: unknown): ApiError {
  const error = (payload as { error?: { code?: string; message?: string; detail?: string } })?.error
  if (error?.message) {
    return new ApiError(error.message, status, error.code ?? 'unknown_error', error.detail ?? null)
  }
  return new ApiError('Something went wrong. Please try again.', status, 'unknown_error', null)
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, { signal })
  const payload = await readPayload(response)
  if (!response.ok) throw toApiError(response.status, payload)
  return payload as T
}

export async function postFile<T>(path: string, file: File, signal?: AbortSignal): Promise<T> {
  const body = new FormData()
  body.append('file', file)

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    body,
    signal,
  })
  const payload = await readPayload(response)
  if (!response.ok) throw toApiError(response.status, payload)
  return payload as T
}

export async function postJson<T>(path: string, data: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal,
  })
  const payload = await readPayload(response)
  if (!response.ok) throw toApiError(response.status, payload)
  return payload as T
}
