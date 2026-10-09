import api from './api'
import type { ComparisonRecord, ComparisonSummary, CostAnalysis, CostAssumptionRequest } from '../types'

export const comparisonService = {
  getSummary: (): Promise<ComparisonSummary> =>
    api.get('/comparison/summary').then((r) => r.data),

  getHistory: (params?: { from_date?: string; to_date?: string }): Promise<ComparisonRecord[]> =>
    api.get('/comparison/history', { params }).then((r) => r.data),

  logFixed: (payload: {
    date: string
    fixed_energy_wh: number
    notes?: string
    data_source?: string
  }): Promise<ComparisonRecord> =>
    api.post('/comparison/record', payload).then((r) => r.data),
}

export const costService = {
  getAnalysis: (): Promise<CostAnalysis> =>
    api.get('/cost/analysis').then((r) => r.data),

  updateAssumptions: (payload: CostAssumptionRequest): Promise<CostAnalysis> =>
    api.post('/cost/assumptions', payload).then((r) => r.data),
}
