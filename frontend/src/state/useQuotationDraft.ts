import { useReducer, type Dispatch } from 'react'
import {
  createDraft,
  quotationDraftReducer,
  type QuotationDraftAction,
  type QuotationDraftState,
} from './quotationDraft'
import type { QuotationPreview } from '../types/quotation'

export type QuotationDraft = QuotationDraftState & {
  dispatch: Dispatch<QuotationDraftAction>
}

/** Holds the preview the person is reviewing, and every edit they make to it. */
export function useQuotationDraft(preview: QuotationPreview): QuotationDraft {
  const [state, dispatch] = useReducer(quotationDraftReducer, preview, createDraft)
  return { ...state, dispatch }
}
