import { describe, expect, it } from 'vitest'
import {
  createDraft,
  flaggedFields,
  itemPath,
  pendingReviewCount,
  quotationDraftReducer,
} from './quotationDraft'
import type { QuotationPreview } from '../types/quotation'
import type { QuotationDraftState } from './quotationDraft'

function preview(): QuotationPreview {
  return {
    quotation: {
      quotation_number: 'Q-1',
      client_name: 'ACME',
      project_name: null,
      items: [
        { sr: '1', description: 'flooring', quantity: 30, unit: 'm2' },
        { sr: '2', description: '', quantity: null, unit: 'm2' },
        { sr: '3', description: 'skirting', quantity: 5, unit: 'm' },
      ],
    },
    review: [
      { field: 'project_name', reason: 'missing', message: 'not found' },
      { field: 'items[1].description', reason: 'missing', message: 'missing from pdf' },
      { field: 'items[1].quantity', reason: 'missing', message: 'not readable' },
    ],
    source: { filename: 'quote.pdf', page_count: 1, warnings: [] },
  }
}

function reduce(actions: Parameters<typeof quotationDraftReducer>[1][]) {
  return actions.reduce(quotationDraftReducer, createDraft(preview()))
}

describe('quotationDraft', () => {
  it('starts from the preview returned by the parser', () => {
    const state = createDraft(preview())

    expect(state.preview.quotation.items).toHaveLength(3)
    expect(pendingReviewCount(state.preview)).toBe(3)
  })

  it('exposes the flagged field paths', () => {
    expect(flaggedFields(preview())).toEqual(
      new Set(['project_name', 'items[1].description', 'items[1].quantity']),
    )
  })

  it('builds item field paths', () => {
    expect(itemPath(2, 'quantity')).toBe('items[2].quantity')
  })

  it('editing a header field clears its review flag', () => {
    const state = reduce([{ type: 'header/set', field: 'project_name', value: 'P-9' }])

    expect(state.preview.quotation.project_name).toBe('P-9')
    expect(flaggedFields(state.preview).has('project_name')).toBe(false)
  })

  it('blanking a header field stores null rather than an empty string', () => {
    const state = reduce([{ type: 'header/set', field: 'client_name', value: '   ' }])

    expect(state.preview.quotation.client_name).toBeNull()
  })

  it('editing a line item field clears only that field flag', () => {
    const state = reduce([{ type: 'item/set', index: 1, field: 'quantity', value: '122' }])

    expect(state.preview.quotation.items[1].quantity).toBe(122)
    const flagged = flaggedFields(state.preview)
    expect(flagged.has('items[1].quantity')).toBe(false)
    expect(flagged.has('items[1].description')).toBe(true)
  })

  it('keeps an unparseable quantity empty instead of guessing', () => {
    const state = reduce([{ type: 'item/set', index: 0, field: 'quantity', value: 'thirty' }])

    expect(state.preview.quotation.items[0].quantity).toBeNull()
  })

  it('accepts decimal quantities', () => {
    const state = reduce([{ type: 'item/set', index: 0, field: 'quantity', value: '7.5' }])

    expect(state.preview.quotation.items[0].quantity).toBe(7.5)
  })

  it('adds a blank line item numbered after the last one', () => {
    const state = reduce([{ type: 'item/add' }])

    const items = state.preview.quotation.items
    expect(items).toHaveLength(4)
    expect(items[3]).toEqual({ sr: '4', description: '', quantity: null, unit: null })
  })

  it('removes a line item', () => {
    const state = reduce([{ type: 'item/remove', index: 0 }])

    expect(state.preview.quotation.items).toHaveLength(2)
    expect(state.preview.quotation.items[0].description).toBe('')
  })

  it('re-points review flags when an earlier item is removed', () => {
    const state = reduce([{ type: 'item/remove', index: 0 }])

    // The flag that pointed at old items[1] must follow the data to its new index.
    expect(flaggedFields(state.preview)).toEqual(
      new Set(['project_name', 'items[0].description', 'items[0].quantity']),
    )
  })

  it('drops the review flag of the item that was removed', () => {
    const state = reduce([{ type: 'item/remove', index: 1 }])

    expect(flaggedFields(state.preview)).toEqual(new Set(['project_name']))
  })

  it('ignores out of range indexes', () => {
    const before = createDraft(preview())

    expect(quotationDraftReducer(before, { type: 'item/remove', index: 99 })).toBe(before)
    expect(quotationDraftReducer(before, { type: 'item/set', index: -1, field: 'unit', value: 'm' })).toBe(
      before,
    )
  })

  it('never invents a sequence number, schedule, start date or status', () => {
    const state = reduce([{ type: 'item/add' }])

    // Those fields are human-controlled and absent from the contract entirely.
    expect(state.preview.quotation).not.toHaveProperty('sequence_number')
    expect(state.preview.quotation).not.toHaveProperty('installation_schedule')
    expect(state.preview.quotation).not.toHaveProperty('start_date')
    expect(state.preview.quotation).not.toHaveProperty('status')
  })
})

/**
 * AGENTS.md section 6 and the backend contract: the SR# is an ERP identifier, so
 * it is text all the way through. Reading it as a number would rewrite "1.130" as
 * "1.13" and "7.90" as "7.9", which are different identifiers in the ERP.
 */
describe('the SR# is kept as the text the ERP printed', () => {
  function hierarchicalPreview(srs: string[]): QuotationDraftState {
    return createDraft({
      ...preview(),
      quotation: {
        ...preview().quotation,
        items: srs.map((sr, position) => ({
          sr,
          description: `item ${position}`,
          quantity: 1,
          unit: 'm2',
        })),
      },
    })
  }

  it.each(['1.1', '1.130', '7.90', '9.133'])('a parsed %s is stored unchanged', (sr) => {
    const state = hierarchicalPreview([sr])

    expect(state.preview.quotation.items[0].sr).toBe(sr)
  })

  it('keeps a hierarchical list in the order and spelling it arrived in', () => {
    const srs = ['1.1', '1.130', '7.90', '9.133']

    const state = hierarchicalPreview(srs)

    expect(state.preview.quotation.items.map((item) => item.sr)).toEqual(srs)
  })

  it('editing an SR# does not read it as a number', () => {
    // "1.130" typed back into the box must stay "1.130", not become 1.13.
    const before = hierarchicalPreview(['1.1'])

    const state = quotationDraftReducer(before, {
      type: 'item/set',
      index: 0,
      field: 'sr',
      value: '1.130',
    })

    expect(state.preview.quotation.items[0].sr).toBe('1.130')
  })

  it('keeps a trailing zero that a leading one would lose', () => {
    const before = hierarchicalPreview(['1'])

    const state = quotationDraftReducer(before, {
      type: 'item/set',
      index: 0,
      field: 'sr',
      value: '007.90',
    })

    expect(state.preview.quotation.items[0].sr).toBe('007.90')
  })

  it('stores a manually added SR# as text, numbered exactly as before', () => {
    const state = reduce([{ type: 'item/add' }])

    const added = state.preview.quotation.items.at(-1)
    expect(added?.sr).toBe('4')
    expect(typeof added?.sr).toBe('string')
  })

  it('stores an empty SR# as null rather than as an empty string', () => {
    const state = reduce([{ type: 'item/set', index: 0, field: 'sr', value: '' }])

    expect(state.preview.quotation.items[0].sr).toBeNull()
  })

  it('leaves quantity alone: it is still a number', () => {
    const state = reduce([{ type: 'item/set', index: 0, field: 'quantity', value: '7.5' }])

    expect(state.preview.quotation.items[0].quantity).toBe(7.5)
    expect(typeof state.preview.quotation.items[0].quantity).toBe('number')
  })
})

/**
 * AGENTS.md section 9: a field that is still missing must stay visibly marked.
 * Editing a flagged field resolves the parser's doubt only when it actually
 * supplies a value — erasing the box does not resolve anything.
 */
describe('review flags survive an edit that supplies nothing', () => {
  const REASONS = ['missing', 'unconfident', 'inconsistent'] as const

  function withFlag(field: string, reason: (typeof REASONS)[number]) {
    return createDraft({
      ...preview(),
      review: [{ field, reason, message: 'please check' }],
    })
  }

  it.each(REASONS)('clears a %s header flag once a value is supplied', (reason) => {
    const state = quotationDraftReducer(withFlag('project_name', reason), {
      type: 'header/set',
      field: 'project_name',
      value: 'MBRC 466',
    })

    expect(state.preview.quotation.project_name).toBe('MBRC 466')
    expect(flaggedFields(state.preview).has('project_name')).toBe(false)
  })

  it.each(REASONS)('keeps a %s header flag when the field is emptied', (reason) => {
    const state = quotationDraftReducer(withFlag('project_name', reason), {
      type: 'header/set',
      field: 'project_name',
      value: '',
    })

    expect(state.preview.quotation.project_name).toBeNull()
    expect(flaggedFields(state.preview).has('project_name')).toBe(true)
  })

  it('keeps a header flag when the field is only whitespace', () => {
    const state = reduce([{ type: 'header/set', field: 'project_name', value: '   ' }])

    expect(flaggedFields(state.preview).has('project_name')).toBe(true)
  })

  it('keeps a quantity flag when the quantity is erased', () => {
    const state = reduce([{ type: 'item/set', index: 1, field: 'quantity', value: '' }])

    expect(state.preview.quotation.items[1].quantity).toBeNull()
    expect(flaggedFields(state.preview).has('items[1].quantity')).toBe(true)
  })

  it('keeps a quantity flag when the typed value is not a number', () => {
    const state = reduce([{ type: 'item/set', index: 1, field: 'quantity', value: 'thirty' }])

    expect(state.preview.quotation.items[1].quantity).toBeNull()
    expect(flaggedFields(state.preview).has('items[1].quantity')).toBe(true)
  })

  it('keeps a description flag when the description is erased', () => {
    const state = reduce([{ type: 'item/set', index: 1, field: 'description', value: '' }])

    expect(state.preview.quotation.items[1].description).toBe('')
    expect(flaggedFields(state.preview).has('items[1].description')).toBe(true)
  })

  it('keeps a unit flag when the unit is erased', () => {
    const state = quotationDraftReducer(withFlag('items[0].unit', 'unconfident'), {
      type: 'item/set',
      index: 0,
      field: 'unit',
      value: '',
    })

    expect(state.preview.quotation.items[0].unit).toBeNull()
    expect(flaggedFields(state.preview).has('items[0].unit')).toBe(true)
  })

  it('leaves an unflagged field unflagged when it is emptied', () => {
    const state = reduce([{ type: 'item/set', index: 0, field: 'unit', value: '' }])

    expect(state.preview.quotation.items[0].unit).toBeNull()
    expect(flaggedFields(state.preview).has('items[0].unit')).toBe(false)
    expect(flaggedFields(state.preview).has('items[1].quantity')).toBe(true)
  })

  it('keeps every flag pointing at the field it belongs to', () => {
    const before = flaggedFields(preview())
    const state = reduce([{ type: 'item/set', index: 0, field: 'description', value: '' }])

    expect(before).toEqual(
      new Set(['project_name', 'items[1].description', 'items[1].quantity']),
    )
    expect(flaggedFields(state.preview)).toEqual(before)
  })

  it('brings a flag back when a value is supplied and then withdrawn', () => {
    // The parser's warning is answered, not deleted. Empty the box again and the
    // same warning must return, or the form would claim to be clean while the
    // field sits blank.
    const answered = reduce([{ type: 'header/set', field: 'project_name', value: 'MBRC 466' }])
    expect(flaggedFields(answered.preview).has('project_name')).toBe(false)

    const withdrawn = quotationDraftReducer(answered, {
      type: 'header/set',
      field: 'project_name',
      value: '',
    })

    expect(withdrawn.preview.quotation.project_name).toBeNull()
    expect(flaggedFields(withdrawn.preview).has('project_name')).toBe(true)
  })

  it('restores the parser\'s own wording, reason and message when it returns', () => {
    const answered = quotationDraftReducer(withFlag('project_name', 'inconsistent'), {
      type: 'header/set',
      field: 'project_name',
      value: 'MBRC 466',
    })
    const withdrawn = quotationDraftReducer(answered, {
      type: 'header/set',
      field: 'project_name',
      value: '',
    })

    expect(withdrawn.preview.review).toEqual([
      { field: 'project_name', reason: 'inconsistent', message: 'please check' },
    ])
  })

  it('does not resurrect a flag the field never had', () => {
    const answered = reduce([{ type: 'item/set', index: 0, field: 'unit', value: 'm2' }])
    const emptied = quotationDraftReducer(answered, {
      type: 'item/set',
      index: 0,
      field: 'unit',
      value: '',
    })

    expect(emptied.preview.review).toEqual(preview().review)
  })

  it('keeps an answered flag pointing at its row when an earlier row is deleted', () => {
    const answered = reduce([
      { type: 'item/set', index: 1, field: 'description', value: 'compound' },
      { type: 'item/remove', index: 0 },
    ])

    // The answered flag for items[1] must have moved to items[0], so restoring
    // it later marks the row that now holds that data.
    expect(answered.resolved.map((flag) => flag.field)).toEqual(['items[0].description'])

    const emptied = quotationDraftReducer(answered, {
      type: 'item/set',
      index: 0,
      field: 'description',
      value: '',
    })
    expect(flaggedFields(emptied.preview).has('items[0].description')).toBe(true)
  })
})
