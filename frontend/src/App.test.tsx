import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import { apiBaseUrl } from './lib/api'

describe('App', () => {
  it('shows the quotation workflow title and planned screens', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Quotation to Excel' })).toBeInTheDocument()
    expect(screen.getByText('Upload quotation PDF')).toBeInTheDocument()
    expect(screen.getByText('Confirm and download Excel')).toBeInTheDocument()
  })
})

describe('apiBaseUrl', () => {
  it('falls back to the local backend when no env value is set', () => {
    expect(apiBaseUrl()).toBe('http://localhost:8000')
  })

  it('strips trailing slashes from the configured base URL', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com///')
    expect(apiBaseUrl()).toBe('https://api.example.com')
    vi.unstubAllEnvs()
  })
})
