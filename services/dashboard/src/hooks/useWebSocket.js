/**
 * hooks/useWebSocket.js
 * Connects to gateway WebSocket for a job, streams live events.
 * Auto-reconnects on disconnect.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { translateEvent } from '../lib/eventTranslator'

const GATEWAY_WS = process.env.NEXT_PUBLIC_GATEWAY_WS || 'ws://localhost:8000'

export function useWebSocket(jobId, targetLocale) {
  const [events, setEvents]       = useState([])
  const [connected, setConnected] = useState(false)
  const wsRef                     = useRef(null)
  const apiKey                    = process.env.NEXT_PUBLIC_LINGO_API_KEY || ''

  const addEvent = useCallback((event) => {
    setEvents(prev => [event, ...prev].slice(0, 100))  // keep last 100
  }, [])

  useEffect(() => {
    if (!jobId) return

    let retryTimeout

    function connect() {
      const ws = new WebSocket(`${GATEWAY_WS}/ws/${jobId}`)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
      }

      ws.onmessage = async (msg) => {
        try {
          const raw        = JSON.parse(msg.data)
          const translated = await translateEvent(raw, targetLocale, apiKey)
          addEvent(translated)
        } catch (e) {
          console.warn('[WS] Failed to parse event:', e)
        }
      }

      ws.onclose = () => {
        setConnected(false)
        // Reconnect after 2s
        retryTimeout = setTimeout(connect, 2000)
      }

      ws.onerror = (e) => {
        console.warn('[WS] Error:', e)
        ws.close()
      }
    }

    connect()

    return () => {
      clearTimeout(retryTimeout)
      if (wsRef.current) wsRef.current.close()
    }
  }, [jobId, targetLocale])

  return { events, connected }
}
