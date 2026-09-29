import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest runs with `globals: false`, so Testing Library cannot see a global
// afterEach and does not register its own. Without this, each test's DOM leaks
// into the next one and queries match more elements than they should.
afterEach(cleanup)
