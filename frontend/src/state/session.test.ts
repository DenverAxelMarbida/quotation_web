import { describe, expect, it } from 'vitest'
import type { ConfirmedQuotation } from '../types/quotation'
import { findDuplicateSequence, nextSequenceNumber } from './session'

function confirmed(sequence: string): ConfirmedQuotation {
  return {
    sequence_number: sequence,
    quotation: {
      quotation_number: 'Q-1',
      client_name: 'ACME',
      project_name: 'Project',
      items: [],
    },
  }
}

describe('nextSequenceNumber', () => {
  it('starts at 001 when the session is empty', () => {
    expect(nextSequenceNumber([])).toBe('001')
  })

  it('continues from the highest confirmed sequence', () => {
    expect(nextSequenceNumber([confirmed('001'), confirmed('002')])).toBe('003')
  })

  it('does not reuse a gap left by a removed sequence', () => {
    // 002 is gone, but the next number must still be past the highest seen.
    expect(nextSequenceNumber([confirmed('001'), confirmed('003')])).toBe('004')
  })

  it('keeps three-digit formatting and rolls over at 100', () => {
    expect(nextSequenceNumber([confirmed('007')])).toBe('008')
    expect(nextSequenceNumber([confirmed('010'), confirmed('011')])).toBe('012')
    expect(nextSequenceNumber([confirmed('099')])).toBe('100')
    expect(nextSequenceNumber([confirmed('100')])).toBe('101')
  })

  it('ignores sequence numbers that are not numbers', () => {
    expect(nextSequenceNumber([confirmed('001'), confirmed('draft')])).toBe('002')
  })
})

describe('findDuplicateSequence', () => {
  it('still reports a sequence number already in the session', () => {
    expect(findDuplicateSequence([confirmed('001')], '001')).toBeDefined()
    expect(findDuplicateSequence([confirmed('001')], '002')).toBeUndefined()
  })
})
