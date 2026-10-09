/**
 * useSimulation — primary real-time data hook.
 *
 * Connects to the WebSocket at /api/ws/simulation and receives a
 * SimulationSnapshot every second. Falls back to HTTP polling at 2s
 * if the WebSocket connection fails or is unavailable.
 *
 * Usage:
 *   const { snapshot, connected, error } = useSimulation()
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { SimulationSnapshot } from '../types'
import { simulationService } from '../services/simulationService'

interface UseSimulationResult {
  snapshot: SimulationSnapshot | null
  connected: boolean          // true = WebSocket live
  error: string | null
  refresh: () => void
}

const WS_URL = (() => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  return `${protocol}//${host}/api/ws/simulation`
})()

const RECONNECT_DELAY_MS = 3000
const FALLBACK_POLL_MS   = 2000

export function useSimulation(): UseSimulationResult {
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const wsRef        = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef   = useRef(true)

  // HTTP fallback
  const pollFallback = useCallback(async () => {
    try {
      const state = await simulationService.getState()
      if (state.snapshot && mountedRef.current) {
        setSnapshot(state.snapshot as SimulationSnapshot)
        setError(null)
      }
    } catch {
      // silent — WS will take over when it reconnects
    }
  }, [])

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPoll = useCallback(() => {
    if (pollRef.current) return
    pollFallback()
    pollRef.current = setInterval(pollFallback, FALLBACK_POLL_MS)
  }, [pollFallback])

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    try {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current) return
        setConnected(true)
        setError(null)
        stopPoll()
      }

      ws.onmessage = (ev) => {
        if (!mountedRef.current) return
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'snapshot' && msg.data) {
            setSnapshot(msg.data as SimulationSnapshot)
          }
        } catch {
          // ignore malformed
        }
      }

      ws.onerror = () => {
        if (!mountedRef.current) return
        setConnected(false)
        startPoll()
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        setConnected(false)
        startPoll()
        // Schedule reconnect
        reconnectRef.current = setTimeout(connect, RECONNECT_DELAY_MS)
      }
    } catch {
      setConnected(false)
      startPoll()
    }
  }, [startPoll, stopPoll])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      if (wsRef.current) wsRef.current.close()
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      stopPoll()
    }
  }, [connect, stopPoll])

  const refresh = useCallback(() => {
    pollFallback()
  }, [pollFallback])

  return { snapshot, connected, error, refresh }
}
