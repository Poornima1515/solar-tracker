import { useState, useCallback } from 'react'
import { telemetryService } from '../services/telemetryService'
import { usePolling } from './usePolling'
import type { LatestTelemetry, DeviceStatusSummary, DailySummary } from '../types'

export function useTelemetry(pollMs = 10000) {
  const [telemetry, setTelemetry] = useState<LatestTelemetry | null>(null)
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatusSummary | null>(null)
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    try {
      const [tel, dev, sum] = await Promise.all([
        telemetryService.getLatest(),
        telemetryService.getDeviceStatus(),
        telemetryService.getDailySummary(),
      ])
      setTelemetry(tel)
      setDeviceStatus(dev)
      setDailySummary(sum)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch telemetry')
    } finally {
      setLoading(false)
    }
  }, [])

  usePolling(fetch, pollMs)

  return { telemetry, deviceStatus, dailySummary, loading, error, refresh: fetch }
}
