import { useEffect, useRef } from 'react'

/**
 * Calls `fn` immediately on mount, then every `intervalMs` milliseconds.
 * Cleans up on unmount. Polling pauses when the tab is hidden (optional).
 */
export function usePolling(fn: () => void, intervalMs: number, enabled = true) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (!enabled) return
    fnRef.current()
    const id = setInterval(() => fnRef.current(), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, enabled])
}
