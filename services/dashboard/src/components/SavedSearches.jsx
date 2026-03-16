/**
 * components/SavedSearches.jsx
 * Session-only saved analyses — cleared on each new browser session.
 * Shows seed paper title + job_id for each entry.
 */
'use client'
import { useState, useEffect } from 'react'

const STORAGE_KEY = 'paperswarm:saved'
const SESSION_KEY = 'paperswarm:session'

function getOrCreateSessionId() {
  let sid = sessionStorage.getItem(SESSION_KEY)
  if (!sid) {
    sid = Math.random().toString(36).slice(2, 10)
    sessionStorage.setItem(SESSION_KEY, sid)
    // New session — clear saved list from previous sessions
    localStorage.removeItem(STORAGE_KEY)
  }
  return sid
}

export function useSavedSearches() {
  const [saved, setSaved] = useState([])

  useEffect(() => {
    getOrCreateSessionId()          // ensures stale data is cleared on new session
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setSaved(JSON.parse(raw))
    } catch {}
  }, [])

  function saveJob(jobId, title, locale, graph = null) {
    setSaved(prev => {
      const exists = prev.find(s => s.jobId === jobId)
      if (exists) {
        if (graph && locale) {
          const next = prev.map(s => s.jobId === jobId ? {
            ...s,
            title,
            graphSnapshots: { ...(s.graphSnapshots || {}), [locale]: graph }
          } : s)
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
          return next
        }
        return prev
      }
      const next = [
        {
          jobId,
          title,
          locale,
          savedAt:        new Date().toISOString(),
          graphSnapshots: graph ? { [locale]: graph } : {},
        },
        ...prev
      ].slice(0, 20)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  function removeJob(jobId) {
    setSaved(prev => {
      const next = prev.filter(s => s.jobId !== jobId)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  return { saved, saveJob, removeJob }
}

export default function SavedSearches({ saved = [], onJobRestore, onRemoveJob, currentJobId, theme = 'dark' }) {
  const dk = theme === 'dark'

  // Only show entries that have at least one graph snapshot (fully completed analyses)
  const completed = saved.filter(item => Object.keys(item.graphSnapshots || {}).length > 0)

  if (completed.length === 0) return null

  return (
    <div className={`px-4 py-3 border-t ${dk ? 'border-white/8' : 'border-gray-200'}`}>
      <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${dk ? 'text-slate-500' : 'text-gray-400'}`}>
        Recent analyses
      </p>
      <div className="space-y-1.5">
        {completed.slice(0, 8).map(item => (
          <div
            key={item.jobId}
            onClick={() => onJobRestore(item)}
            className={`group flex flex-col gap-0.5 rounded-xl px-3 py-2 cursor-pointer transition-colors
                        ${item.jobId === currentJobId
                          ? dk ? 'bg-sky-500/10 border border-sky-500/20' : 'bg-sky-50 border border-sky-200'
                          : dk ? 'hover:bg-white/5 border border-transparent' : 'hover:bg-gray-50 border border-transparent'
                        }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className={`text-xs font-medium leading-snug line-clamp-2 flex-1
                                ${dk ? 'text-slate-200' : 'text-gray-800'}`}>
                {item.title || 'Untitled'}
              </span>
              <button
                onClick={e => { e.stopPropagation(); onRemoveJob?.(item.jobId) }}
                className={`opacity-0 group-hover:opacity-100 shrink-0 text-xs leading-none
                             transition-opacity mt-0.5
                             ${dk ? 'text-slate-600 hover:text-slate-300' : 'text-gray-300 hover:text-gray-500'}`}
              >
                ✕
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-mono ${dk ? 'text-slate-600' : 'text-gray-400'}`}>
                #{item.jobId}
              </span>
              {Object.keys(item.graphSnapshots || {}).length > 1 && (
                <span className={`text-xs px-1.5 py-0.5 rounded font-mono
                                  ${dk ? 'bg-sky-500/10 text-sky-500' : 'bg-sky-50 text-sky-600'}`}>
                  {Object.keys(item.graphSnapshots).join(' · ')}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
