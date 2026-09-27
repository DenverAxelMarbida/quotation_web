const DEFAULT_API_BASE_URL = 'http://localhost:8000'

/** Base URL of the FastAPI backend, without a trailing slash. */
export function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL
  return (configured ?? DEFAULT_API_BASE_URL).replace(/\/+$/, '')
}

export type HealthResponse = {
  status: string
  version: string
}

/**
 * Connectivity probe for the backend. This is the only API call that exists at
 * this stage; quotation endpoints arrive in later phases (AGENTS.md section 16).
 */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${apiBaseUrl()}/api/health`, { signal })
  if (!response.ok) {
    throw new Error(`Backend responded with status ${response.status}`)
  }
  return (await response.json()) as HealthResponse
}
