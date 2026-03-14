/**
 * components/EventFeed.jsx
 * Bottom bar — live streaming events from WebSocket.
 * Shows agent activity in real-time as the pipeline runs.
 */
'use client'
import { useState } from 'react'

const EVENT_META = {
  // Planner
  analysis_started:      { icon: '⚡', color: 'text-blue-600',   label: 'Analysis started' },
  paper_fetched:         { icon: '📄', color: 'text-blue-500',   label: 'Seed paper fetched' },
  workers_dispatched:    { icon: '🚀', color: 'text-blue-500',   label: 'Workers dispatched' },
  // Similarity
  similarity_started:    { icon: '🔍', color: 'text-indigo-500', label: 'Similarity analysis' },
  similarity_complete:   { icon: '✓',  color: 'text-indigo-600', label: 'Similarity done' },
  // Future research
  future_research_started:  { icon: '🔭', color: 'text-purple-500', label: 'Gap extraction' },
  future_research_complete: { icon: '✓',  color: 'text-purple-600', label: 'Gaps found' },
  // Reconciler
  reconciler_started:    { icon: '⚙️', color: 'text-gray-500',   label: 'Building graph' },
  graph_ready:           { icon: '◈',  color: 'text-green-600',  label: 'Graph ready' },
  // Translation
  translation_started:   { icon: '🌐', color: 'text-orange-500', label: 'Translating' },
  translation_progress:  { icon: '🌐', color: 'text-orange-400', label: 'Translating' },
  translation_complete:  { icon: '✓',  color: 'text-orange-600', label: 'Translation done' },
  // Search
  search_started:        { icon: '🔎', color: 'text-blue-500',   label: 'Searching papers' },
  search_results:        { icon: '📚', color: 'text-blue-600',   label: 'Results ready' },
  search_no_results:     { icon: '∅',  color: 'text-red-400',    label: 'No results' },
  // Errors
  error:                 { icon: '✗',  color: 'text-red-500',    label: 'Error' },
}

function formatEventText(event) {
  const meta = EVENT_META[event.event] || { icon: '·', color: 'text-gray-400', label: event.event }
  const p    = event.payload || {}

  let detail = ''
  if (event.event === 'paper_fetched')          detail = p.title?.slice(0, 50)
  if (event.event === 'workers_dispatched')      detail = `${p.similar_count || 0} similarity · ${p.future_count || 0} gap workers`
  if (event.event === 'similarity_complete')     detail = `${p.paper_title?.slice(0, 40)} — ${Math.round((p.score || 0) * 100)}% match`
  if (event.event === 'future_research_complete') detail = `${p.gaps_found || 0} gaps found`
  if (event.event === 'graph_ready')             detail = `${p.node_count || 0} nodes · ${p.edge_count || 0} edges`
  if (event.event === 'translation_progress')    detail = `${p.done || 0}/${p.total || 0} fields`
  if (event.event === 'search_results')          detail = `${p.papers?.length || 0} papers`
  if (event.event === 'error')                   detail = p.message

  return { meta, detail }
}

export default function EventFeed({ events, connected, theme = "dark" }) {
  const dk = theme === "dark"
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? events : events.slice(0, 4)

  return (
    <div className={`border-t ${dk ? "border-white/8 bg-slate-900" : "border-gray-200 bg-white"}`}>
      {/* Header bar */}
      <div
        className={`flex items-center justify-between px-4 py-2 cursor-pointer ${dk ? "hover:bg-white/5" : "hover:bg-gray-50"}`}
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-gray-300'}`} />
          <span className={`text-xs font-mono ${dk ? "text-slate-500" : "text-gray-500"}`}>
            {connected ? 'Live' : 'Disconnected'} · {events.length} events
          </span>
        </div>
        <button className={`text-xs ${dk ? "text-slate-500 hover:text-slate-300" : "text-gray-400 hover:text-gray-600"}`}>
          {expanded ? '▾ Collapse' : '▸ Expand'}
        </button>
      </div>

      {/* Event list */}
      {expanded && (
        <div className="px-4 pb-3 space-y-1 max-h-40 overflow-y-auto">
          {visible.length === 0 && (
            <p className="text-xs text-gray-400 py-2">Waiting for pipeline events…</p>
          )}
          {visible.map((event, i) => {
            const { meta, detail } = formatEventText(event)
            return (
              <div key={i} className="event-item flex items-baseline gap-2 py-0.5">
                <span className={`text-xs font-mono shrink-0 ${meta.color}`}>
                  {meta.icon}
                </span>
                <span className="text-xs text-gray-500 font-mono shrink-0">
                  {meta.label}
                </span>
                {detail && (
                  <span className="text-xs text-gray-400 truncate">{detail}</span>
                )}
                <span className="text-xs text-gray-300 font-mono ml-auto shrink-0">
                  {event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : ''}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Collapsed summary — show last event */}
      {!expanded && events.length > 0 && (
        <div className="px-4 pb-2">
          {(() => {
            const { meta, detail } = formatEventText(events[0])
            return (
              <div className="flex items-center gap-2">
                <span className={`text-xs font-mono ${meta.color}`}>{meta.icon}</span>
                <span className="text-xs text-gray-500">{meta.label}</span>
                {detail && <span className="text-xs text-gray-400 truncate">{detail}</span>}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}