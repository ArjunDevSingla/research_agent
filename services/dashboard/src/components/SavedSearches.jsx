/**
 * components/SavedSearches.jsx
 * Researcher profile — saved jobs in localStorage.
 * Pinned papers, recent searches, language preference.
 */
'use client'
import { useState, useEffect } from 'react'

const STORAGE_KEY = 'paperswarm:saved'

export function useSavedSearches() {
  const [saved, setSaved] = useState([])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setSaved(JSON.parse(raw))
    } catch {}
  }, [])

  function saveJob(jobId, title, locale) {
    setSaved(prev => {
      const exists = prev.find(s => s.jobId === jobId)
      if (exists) return prev
      const next = [
        { jobId, title, locale, savedAt: new Date().toISOString() },
        ...prev
      ].slice(0, 20)  // keep last 20
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

export default function SavedSearches({ onJobRestore, currentJobId }) {
  const { saved, removeJob } = useSavedSearches()

  if (saved.length === 0) return null

  return (
    <div className="px-5 py-3 border-t border-paper-border">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
        Recent analyses
      </p>
      <div className="space-y-1">
        {saved.slice(0, 5).map(item => (
          <div
            key={item.jobId}
            className={`flex items-center gap-2 group rounded-lg px-2 py-1.5 cursor-pointer
                        hover:bg-paper transition-colors
                        ${item.jobId === currentJobId ? 'bg-accent/5' : ''}`}
            onClick={() => onJobRestore(item.jobId)}
          >
            <span className="text-xs font-mono text-gray-400 shrink-0">◈</span>
            <span className="text-sm text-gray-700 truncate flex-1">{item.title}</span>
            <button
              onClick={e => { e.stopPropagation(); removeJob(item.jobId) }}
              className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-500
                         text-xs transition-opacity shrink-0"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
