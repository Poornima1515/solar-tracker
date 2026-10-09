/**
 * useEvents — streams SystemEvent objects from /api/ws/events.
 * Falls back to polling /api/simulation/events if WebSocket is unavailable.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { SystemEvent } from '../types'
import { simulationService } from '../services/simulationService'

interface UseEventsResult {
  events: SystemEvent[]
  connected: boolean
}

const WS_URL = (() => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  return `${protocol}//${host}/api/ws/events`
})()

const MAX_EVENTS = 200

export function useEvents(): UseEventsResult {
  const [events, setEvents] = useState<SystemEvent[]>([])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const mountedRef = useRef(true)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const addEvents = useCallback((incoming: SystemEvent[]) => {
    setEvents((prev) => {
      const existingIds = new Set(prev.map((e) => e.id))
      const newOnes = incoming.filter((e) => !existingIds.has(e.id))
      if (!newOnes.length) return prev
      const merged = [...newOnes, ...prev].slice(0, MAX_EVENTS)
      return merged.sort((a, b) => b.id - a.id)
    })
  }, [])

  const pollFallback = useCallback(async () => {
    try {
      const { events: evs } = await simulationService.getEvents(50)
      if (mountedRef.current) addEvents(evs)
    } catch {/* silent */}
  }, [addEvents])

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    try {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current) return
        setConnected(true)
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      }

      ws.onmessage = (ev) => {
        if (!mountedRef.current) return
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'event') addEvents([msg.data])
          if (msg.type === 'events_batch') addEvents(msg.data)
        } catch {/* ignore */}
      }

      ws.onerror = () => {
        if (!mountedRef.current) return
        setConnected(false)
        if (!pollRef.current) pollRef.current = setInterval(pollFallback, 3000)
      }

      ws.onclose = () => {
        if (!mountedRef.current) return
        setConnected(false)
        if (!pollRef.current) pollRef.current = setInterval(pollFallback, 3000)
        reconnectRef.current = setTimeout(connect, 4000)
      }
    } catch {
      if (!pollRef.current) pollRef.current = setInterval(pollFallback, 3000)
    }
  }, [addEvents, pollFallback])

  useEffect(() => {
    mountedRef.current = true
    pollFallback() // get initial events immediately
    connect()
    return () => {
      mountedRef.current = false
      if (wsRef.current) wsRef.current.close()
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [connect, pollFallback])

  return { events, connected }
}
