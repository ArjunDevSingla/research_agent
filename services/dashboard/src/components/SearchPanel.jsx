'use client'
import { useState, useRef } from 'react'

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8000'

// Detect non-Latin script languages from query text using unicode ranges
function detectNonEnglishLocale(text) {
  const scripts = [
    { range: /[\u0900-\u097F]/, locale: 'hi' },  // Devanagari (Hindi)
    { range: /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/, locale: 'ar' }, // Arabic/Urdu
    { range: /[\u4E00-\u9FFF\u3400-\u4DBF]/, locale: 'zh' }, // Chinese
    { range: /[\u3040-\u309F\u30A0-\u30FF]/, locale: 'ja' }, // Japanese
    { range: /[\uAC00-\uD7AF]/, locale: 'ko' },  // Korean
    { range: /[\u0E00-\u0E7F]/, locale: 'th' },  // Thai
    { range: /[\u0400-\u04FF]/, locale: 'ru' },  // Cyrillic (Russian/Ukrainian)
    { range: /[\u0980-\u09FF]/, locale: 'bn' },  // Bengali
    { range: /[\u0A00-\u0A7F]/, locale: 'pa' },  // Gurmukhi (Punjabi)
    { range: /[\u0B00-\u0B7F]/, locale: 'or' },  // Odia
    { range: /[\u0C00-\u0C7F]/, locale: 'te' },  // Telugu
    { range: /[\u0B80-\u0BFF]/, locale: 'ta' },  // Tamil
  ]
  for (const { range, locale } of scripts) {
    if (range.test(text)) return locale
  }
  return null
}

export default function SearchPanel({ onJobStart, onLocaleDetected, targetLocale, searchResults = [], theme = 'dark', isPipelineRunning = false }) {
  const [query,       setQuery]       = useState('')
  const [localResults,setLocalResults]= useState([])
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const dk = theme === 'dark'

  const results = searchResults.length > 0 ? searchResults : localResults
  const [searchJobId, setSearchJobId] = useState(null)
  const [confirming,  setConfirming]  = useState(null)  // paper_id being confirmed
  const [selectedPaperId, setSelectedPaperId] = useState(null)
  const [confirmModal, setConfirmModal] = useState(null) // { paper, resolve }
  const confirmResolveRef = useRef(null)

  const isArxivId = (q) =>
    /^\d{4}\.\d{4,5}$/.test(q.trim()) || q.includes('arxiv.org')

  // Core search execution — called after locale is resolved
  async function doSearch(locale) {
    setLoading(true)
    setError('')
    setLocalResults([])
    setSearchJobId(null)

    try {
      if (isArxivId(query)) {
        const resp = await fetch(`${GATEWAY}/analyze`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ arxiv_id: query.trim(), target_locale: locale })
        })
        const data = await resp.json()
        if (data.job_id) {
          onJobStart(data.job_id, query.trim(), undefined, locale)
        } else {
          setError(data.message || 'Analysis failed')
        }
      } else {
        const resp = await fetch(`${GATEWAY}/search`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ query: query.trim(), locale })
        })
        const data = await resp.json()
        if (data.job_id) {
          setSearchJobId(data.job_id)
          onJobStart(data.job_id, query.trim(), 'search', locale)
          setLocalResults([])
        } else {
          setError(data.message || 'Search failed')
        }
      }
    } catch {
      setError('Could not reach gateway. Is it running?')
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!query.trim()) return

    // For natural language queries, detect non-English script client-side
    if (!isArxivId(query)) {
      const detected = detectNonEnglishLocale(query)
      if (detected && onLocaleDetected) {
        // Show centered modal — search is paused until user responds
        onLocaleDetected(detected, (chosenLocale) => doSearch(chosenLocale))
        return
      }
      // No non-English script detected → use current TopBar locale
      doSearch(targetLocale)
      return
    }

    // ArxivID → use current targetLocale (set by TopBar)
    doSearch(targetLocale)
  }

  function showConfirmModal(paper) {
    return new Promise(resolve => {
      confirmResolveRef.current = resolve
      setConfirmModal({ paper })
    })
  }

  async function handlePaperSelect(paper) {
    if (isPipelineRunning) {
      const ok = await showConfirmModal(paper)
      if (!ok) return
    }
    if (!paper.arxiv_url) {
      setError('This paper has no arXiv URL — cannot analyze')
      return
    }
    setConfirming(paper.paper_id)
    setError('')
    try {
      // Use existing search job_id if available, otherwise generate a new analysis
      if (searchJobId) {
        const resp = await fetch(`${GATEWAY}/confirm`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            job_id:        searchJobId,
            arxiv_url:     paper.arxiv_url,
            target_locale: targetLocale,
          })
        })
        const data = await resp.json()
        if (data.status === 'error') {
          setError(data.message || 'Confirm failed')
        } else {
          onJobStart(searchJobId, paper.title || paper.original_title, 'confirm', targetLocale)
          setSelectedPaperId(paper.paper_id)
        }
      } else {
        // Fallback: direct analyze
        const resp = await fetch(`${GATEWAY}/analyze`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            arxiv_url:     paper.arxiv_url,
            target_locale: targetLocale,
          })
        })
        const data = await resp.json()
        if (data.job_id) {
          onJobStart(data.job_id, paper.title || paper.original_title, 'confirm', targetLocale)
          setSelectedPaperId(paper.paper_id)
        } else {
          setError(data.message || 'Analysis failed')
        }
      }
    } catch {
      setError('Could not reach gateway')
    } finally {
      setConfirming(null)
    }
  }

  function handleConfirmYes() {
    setConfirmModal(null)
    confirmResolveRef.current?.(true)
  }

  function handleConfirmNo() {
    setConfirmModal(null)
    confirmResolveRef.current?.(false)
  }

  return (
    <div className="flex flex-col h-full">

      {/* Confirm override modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleConfirmNo} />
          <div className={`relative w-80 rounded-2xl p-6 shadow-2xl
                           ${dk ? 'bg-slate-900 border border-white/10' : 'bg-white border border-gray-200'}`}>
            <div className="text-2xl mb-3 text-center">⚠️</div>
            <h3 className={`text-sm font-semibold text-center mb-2 ${dk ? 'text-white' : 'text-gray-900'}`}>
              Graph in progress
            </h3>
            <p className={`text-xs text-center leading-relaxed mb-5 ${dk ? 'text-slate-400' : 'text-gray-500'}`}>
              A graph is currently being built. Start a new analysis anyway? The current graph will be saved to your library.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleConfirmNo}
                className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors
                             ${dk ? 'border-white/15 text-slate-300 hover:bg-white/8' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmYes}
                className="flex-1 py-2 rounded-xl text-xs font-medium bg-sky-500 hover:bg-sky-400 text-white transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className={`px-5 pt-5 pb-4 border-b ${dk ? 'border-white/8' : 'border-gray-100'}`}>
        <h1 className={`font-display text-2xl font-light mb-0.5 ${dk ? 'text-white' : 'text-gray-900'}`}>
          PaperSwarm
        </h1>
        <p className={`text-xs font-light ${dk ? 'text-slate-500' : 'text-gray-400'}`}>
          Research synthesis · Any language
        </p>
      </div>

      {/* Search */}
      <div className={`px-5 py-4 border-b ${dk ? 'border-white/8' : 'border-gray-100'}`}>
        <form onSubmit={handleSubmit}>
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search or paste arXiv ID…"
              className={`w-full px-4 py-2.5 pr-12 text-sm rounded-xl border
                           focus:outline-none focus:ring-2 transition-all
                           ${dk
                             ? 'bg-slate-800/60 border-white/10 text-slate-200 placeholder-slate-600 focus:border-sky-500/50 focus:ring-sky-500/10'
                             : 'bg-white border-gray-200 text-gray-800 placeholder-gray-300 focus:border-blue-300 focus:ring-blue-100'
                           }`}
            />
            <button type="submit" disabled={loading || !query.trim()}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg
                               bg-sky-500 text-white disabled:opacity-40 hover:bg-sky-400 transition-colors">
              {loading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                </svg>
              )}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          <p className={`mt-1.5 text-xs ${dk ? 'text-slate-600' : 'text-gray-400'}`}>
            {isArxivId(query) ? '→ Direct analysis' : 'Natural language or arXiv ID'}
          </p>
        </form>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
        {results.length === 0 && !loading && (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🔬</div>
            <p className={`text-sm font-light ${dk ? 'text-slate-500' : 'text-gray-400'}`}>
              Search for a topic or paste arXiv ID
            </p>
          </div>
        )}
        {results.map((paper, i) => (
          <SearchResultCard
            key={paper.paper_id || i}
            paper={paper}
            index={i}
            dk={dk}
            onClick={() => handlePaperSelect(paper)}
            loading={confirming === paper.paper_id}
            selected={selectedPaperId === paper.paper_id}
          />
        ))}
      </div>
    </div>
  )
}

function SearchResultCard({ paper, index, dk, onClick, loading, selected }) {
  return (
    <div
      onClick={onClick}
      className={`p-3 rounded-xl border cursor-pointer transition-all duration-150
                  hover:-translate-y-0.5 relative
                  ${selected
                    ? dk ? 'bg-sky-500/15 border-sky-500/50' : 'bg-sky-50 border-sky-400'
                    : loading
                    ? dk ? 'bg-slate-700/50 border-sky-500/40' : 'bg-blue-50 border-blue-300'
                    : dk ? 'bg-slate-800/50 border-white/8 hover:border-white/15 hover:bg-slate-800/80'
                         : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'
                  }`}
    >
      {loading && (
        <div className="absolute top-2 right-2">
          <svg className={`w-3.5 h-3.5 animate-spin ${dk ? 'text-sky-400' : 'text-sky-500'}`}
               fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
        </div>
      )}
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className={`text-xs font-mono ${dk ? 'text-slate-600' : 'text-gray-300'}`}>#{index + 1}</span>
        {paper.year && <span className={`text-xs shrink-0 ${dk ? 'text-slate-500' : 'text-gray-400'}`}>{paper.year}</span>}
      </div>
      <p className={`text-sm font-medium leading-snug mb-1 ${dk ? 'text-slate-200' : 'text-gray-800'}`}>
        {paper.translated_title || paper.title}
      </p>
      {paper.authors?.length > 0 && (
        <p className={`text-xs truncate mb-1.5 ${dk ? 'text-slate-500' : 'text-gray-400'}`}>
          {paper.authors.slice(0, 2).join(', ')}{paper.authors.length > 2 ? ` +${paper.authors.length - 2}` : ''}
        </p>
      )}
      {paper.abstract && (
        <p className={`text-xs line-clamp-2 leading-relaxed ${dk ? 'text-slate-600' : 'text-gray-500'}`}>
          {paper.translated_abstract || paper.abstract}
        </p>
      )}
    </div>
  )
}