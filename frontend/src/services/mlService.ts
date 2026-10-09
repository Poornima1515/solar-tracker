import api from './api'
import type {
  ModelStatus,
  OptimisationResponse,
  PredictionResponse,
  SolarPosition,
} from '../types'

export const mlService = {
  getStatus: (): Promise<ModelStatus> =>
    api.get('/ml/status').then((r) => r.data),

  predict: (params: {
    temperature?: number
    humidity?: number
    datetime_iso?: string
  }): Promise<PredictionResponse> =>
    api.post('/ml/predict', params).then((r) => r.data),

  optimise: (): Promise<OptimisationResponse> =>
    api.get('/ml/optimise').then((r) => r.data),

  getSolarPosition: (): Promise<SolarPosition> =>
    api.get('/ml/solar-position').then((r) => r.data),

  getFeatureImportance: (): Promise<{ feature: string; importance: number }[]> =>
    api.get('/ml/feature-importance').then((r) => r.data),

  triggerTraining: (params: {
    n_estimators?: number
    max_depth?: number
    learning_rate?: number
  }): Promise<{ success: boolean; message: string }> =>
    api.post('/ml/train', params).then((r) => r.data),
}
