import api from './api'
import type {
  LatestTelemetry,
  TelemetryHistory,
  DailySummary,
  DeviceStatusSummary,
} from '../types'

export const telemetryService = {
  getLatest: (): Promise<LatestTelemetry> =>
    api.get('/telemetry/latest').then((r) => r.data),

  /**
   * Fetch time-range history for charts.
   * `from` and `to` must be ISO-8601 strings (e.g. new Date().toISOString()).
   * The backend accepts them as query params named `from` and `to`.
   */
  getHistory: (params: {
    from?: string
    to?: string
    limit?: number
  }): Promise<TelemetryHistory> =>
    api
      .get('/telemetry/history', {
        params: {
          from: params.from,
          to: params.to,
          limit: params.limit ?? 1000,
        },
      })
      .then((r) => r.data),

  getDailySummary: (): Promise<DailySummary> =>
    api.get('/telemetry/summary/today').then((r) => r.data),

  getDeviceStatus: (): Promise<DeviceStatusSummary> =>
    api.get('/device/status').then((r) => r.data),
}
