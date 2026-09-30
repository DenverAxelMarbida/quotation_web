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

describe('nextSequenceNumber with an imported monitoring workbook', () => {
  /** The one value the importer reduces a whole workbook to. */
  function baseline(highestSequence: string | null) {
    return { highestSequence }
  }

  it('continues from a monitor that has reached 007', () => {
    // The workbook already holds 007, so the first new quotation is 008 even
    // though nothing has been confirmed in this session yet.
    expect(nextSequenceNumber([], baseline('007'))).toBe('008')
  })

  it('carries on past a quotation it has already added', () => {
    // 007 from the monitor, 008 confirmed from a PDF, so the next is 009.
    expect(nextSequenceNumber([confirmed('008')], baseline('007'))).toBe('009')
  })

  it('takes the highest of the monitor and the session, not the larger count', () => {
    // A dense monitor (001, 002, 007) and a gappy one (001, 007) both reduce to
    // the same highest value before they reach this function, so both continue
    // at 008.
    expect(nextSequenceNumber([], baseline('007'))).toBe('008')
  })

  it('cannot reuse a gap the imported workbook left behind', () => {
    // The monitor holds 001 and 007. Nothing here knows that 002 to 006 are
    // free, because it is only ever shown 007. A maximum cannot fill a gap, and
    // there is no code here that counts rows or looks for a free number.
    expect(nextSequenceNumber([], baseline('007'))).toBe('008')
  })

  it('uses the baseline it is given rather than working it out again', () => {
    // Were this function to scan the rows itself it would see only 001 and
    // answer 002, handing out a number the workbook already used.
    expect(nextSequenceNumber([], baseline('001'))).toBe('002')
  })

  it('behaves exactly as before when no monitor has been imported', () => {
    // The unchanged path: no baseline, an empty session, and an existing
    // session with a gap in it.
    expect(nextSequenceNumber([], baseline(null))).toBe('001')
    expect(nextSequenceNumber([confirmed('001'), confirmed('003')], baseline(null))).toBe('004')
  })

  it('keeps three-digit formatting when the monitor supplies the highest', () => {
    expect(nextSequenceNumber([], baseline('099'))).toBe('100')
    expect(nextSequenceNumber([], baseline('007'))).toBe('008')
  })

  it('ignores a baseline that is not a number', () => {
    // Treated the same way as a confirmed sequence that is not a number: skipped,
    // so the session is left to decide on its own.
    expect(nextSequenceNumber([], baseline('draft'))).toBe('001')
    expect(nextSequenceNumber([confirmed('007')], baseline('draft'))).toBe('008')
  })

  it('reads only the highest, so editing a row cannot change the answer', () => {
    // The baseline carries identity and nothing else, so the working copy the
    // monitor editor holds has no route into this calculation. Two baselines read
    // from the same workbook give the same answer however many rows were edited
    // in between.
    const beforeEdits = baseline('007')
    const afterEdits = baseline('007')
    expect(nextSequenceNumber([], afterEdits)).toBe(nextSequenceNumber([], beforeEdits))
    expect(nextSequenceNumber([], afterEdits)).toBe('008')
  })
})

describe('findDuplicateSequence', () => {
  it('still reports a sequence number already in the session', () => {
    expect(findDuplicateSequence([confirmed('001')], '001')).toBeDefined()
    expect(findDuplicateSequence([confirmed('001')], '002')).toBeUndefined()
  })
})
