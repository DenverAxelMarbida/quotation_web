/**
 * The rule that turns three dates into a Status, on its own.
 *
 * It is the same rule the backend applies when it writes a workbook, so a row
 * shown here and the same row in Excel cannot disagree. Only what the three
 * fields contain matters: no value is remembered, and nothing else -- least of
 * all a Status somebody typed into a file -- can change the answer.
 *
 * The rule, in priority order (AGENTS.md sections 6 and 7):
 *
 *   a Completion Date means the work is Completed
 *   a Schedule and a Start Date together mean it is Ongoing
 *   anything else means it is On Hold
 *
 * `''`, `'-'` and a value made only of spaces all mean "nothing set". They are
 * how an empty cell arrives once it has been through a spreadsheet, and
 * treating any of them as a date would call unfinished work finished.
 */

import { describe, expect, it } from 'vitest'
import { deriveStatus } from './status'

describe('deriveStatus', () => {
  it('says Completed as soon as there is a completion date', () => {
    expect(deriveStatus('15-20 Nov 2026', '01/11/2026', '20/11/2026')).toBe('Completed')
  })

  it('says Completed when only the completion date is set', () => {
    expect(deriveStatus('', null, '20/11/2026')).toBe('Completed')
  })

  it('takes the completion date as the answer even when the others say otherwise', () => {
    // The last date in the life of a job outranks the two before it, so an
    // unfinished schedule cannot keep a finished job looking unfinished.
    expect(deriveStatus('October 2026', null, '31/10/2026')).toBe('Completed')
  })

  it('says Ongoing when the job is scheduled and has started, but is not finished', () => {
    expect(deriveStatus('15-20 Nov 2026', '15/11/2026', null)).toBe('Ongoing')
  })

  it('says Ongoing for phrases the user typed, not only for dates', () => {
    expect(deriveStatus('to be agreed', 'start agreed verbally', '')).toBe('Ongoing')
  })

  it('says On Hold when there is a schedule but no start date', () => {
    expect(deriveStatus('15-20 Nov 2026', null, null)).toBe('On Hold')
  })

  it('says On Hold when there is a start date but nothing scheduled', () => {
    expect(deriveStatus('', '15/11/2026', null)).toBe('On Hold')
  })

  it('says On Hold when nothing has been set at all', () => {
    expect(deriveStatus('', null, null)).toBe('On Hold')
  })

  it('treats a dash as nothing set, the way a spreadsheet shows an empty cell', () => {
    expect(deriveStatus('-', '-', '-')).toBe('On Hold')
    expect(deriveStatus('-', '-', null)).toBe('On Hold')
  })

  it('treats whitespace as nothing set', () => {
    expect(deriveStatus('   ', '  ', '\t')).toBe('On Hold')
  })

  it('still calls a scheduled and started job Ongoing when the completion cell is a dash', () => {
    expect(deriveStatus('November 2026', '01/11/2026', ' - ')).toBe('Ongoing')
  })

  it('accepts undefined the same way it accepts null', () => {
    expect(deriveStatus(undefined, undefined, undefined)).toBe('On Hold')
    expect(deriveStatus(undefined, '01/11/2026', undefined)).toBe('On Hold')
    expect(deriveStatus(undefined, undefined, '01/11/2026')).toBe('Completed')
  })

  it('never returns a status outside the three the workbook knows', () => {
    const answers = [
      deriveStatus('', '', ''),
      deriveStatus('a', 'b', ''),
      deriveStatus('a', '', 'c'),
    ]
    expect(answers).toEqual(['On Hold', 'Ongoing', 'Completed'])
  })
})
