'use client'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'

import SearchPanel     from '../../components/SearchPanel'
import NodeDetailPanel from '../../components/NodeDetailPanel'
import EventFeed       from '../../components/EventFeed'
import TopBar          from '../../components/TopBar'
import StatusBanner    from '../../components/StatusBanner'
import SavedSearches, { useSavedSearches } from '../../components/SavedSearches'

import { useWebSocket } from '../../hooks/useWebSocket'
import { useGraph }     from '../../hooks/useGraph'

const KnowledgeGraph = dynamic(
  () => import('../../components/KnowledgeGraph'),
  { ssr: false }
)

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8000'

export default function Dashboard() {
  const [jobId,            setJobId]            = useState(null)
  const [targetLocale,     setTargetLocale]      = useState('en')
  const [selectedNode,     setSelectedNode]      = useState(null)
  const [searchResults,    setSearchResults]     = useState([])
  const [pipelineStatus,   setPipelineStatus]    = useState(null)
  const [theme,            setTheme]             = useState('dark')
  const [pdfNode,          setPdfNode]           = useState(null)   // node selected for PDF view
  const [view,             setView]              = useState('graph') // 'graph' | 'pdf'
  const [restoredGraph,    setRestoredGraph]     = useState(null)   // graph snapshot from localStorage
  const [localeModal,      setLocaleModal]       = useState(null)   // { locale, proceedFn } — centered modal
  const [pdfTranslations,    setPdfTranslations]    = useState({})     // locale → { status, page, total, url }
  const [activePdfLocale,    setActivePdfLocale]    = useState(null)   // currently viewed translation locale
  const [pipelineBlock,      setPipelineBlock]      = useState(false)  // blocks translate while graph builds
  const [toast,              setToast]              = useState(null)   // { msg, type }
  const pollRef               = useRef(null)
  const toastTimerRef         = useRef(null)
  const selectedNodeRef       = useRef(null)
  const inProgressPdfLocaleRef = useRef(null)
  selectedNodeRef.current     = selectedNode   // always tracks latest without being a dep

  const dk = theme === 'dark'
  const isPipelineRunning = !!pipelineStatus && pipelineStatus.stage !== 'done' && pipelineStatus.stage !== 'error'

  function showToast(msg, type = 'error') {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ msg, type })
    toastTimerRef.current = setTimeout(() => setToast(null), 4500)
  }

  const { saved, saveJob, removeJob }  = useSavedSearches()
  const { events, connected }         = useWebSocket(jobId, targetLocale)
  const { graph, elements, loading, refetch } = useGraph(jobId, targetLocale, restoredGraph)

  // ── Theme persistence ─────────────────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('paperswarm:theme')
    if (saved) setTheme(saved)
  }, [])

  function toggleTheme() {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem('paperswarm:theme', next)
      return next
    })
  }

  // ── Poll /status while pipeline running ───────────────────────────────────
  useEffect(() => {
    if (!jobId) return
    if (graph) { clearInterval(pollRef.current); return }

    pollRef.current = setInterval(async () => {
      if (!jobId) { clearInterval(pollRef.current); return }
      try {
        const resp = await fetch(`${GATEWAY}/status/${jobId}`)
        if (!resp.ok) return
        const s = await resp.json()

        if (s.complete || s.graph_ready) {
          clearInterval(pollRef.current)
          if (targetLocale !== 'en') {
            // Wait for translation before showing the graph
            setPipelineStatus({ stage: 'translating', detail: 'Graph ready · translating…' })
          } else {
            setPipelineStatus({ stage: 'done', detail: 'Graph ready' })
            refetch()
          }
          return
        }

        const simDone  = s.similarity?.done  || 0
        const simTotal = s.similarity?.total || 0
        const futDone  = s.future_research?.done || 0

        if (simDone > 0 || futDone > 0) {
          setPipelineStatus({
            stage:  'analyzing',
            detail: `Similarity ${simDone}/${simTotal} · Gaps ${futDone > 0 ? '✓' : '…'}`
          })
        }
      } catch {}
    }, 3000)

    return () => clearInterval(pollRef.current)
  }, [jobId, graph, targetLocale])

  // ── WS events ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!events.length) return
    const latest = events[0]
    const e = latest.event
    const p = latest.payload || {}

    if (e === 'analysis_started' || e === 'paper_fetched') {
      setPipelineStatus({ stage: 'fetching', detail: p.title ? `"${p.title?.slice(0, 50)}"` : 'Fetching paper…' })
    }
    if (e === 'workers_dispatched') {
      setPipelineStatus({ stage: 'analyzing', detail: `${p.similar_count || '?'} papers · ${p.future_count || '?'} gap workers` })
    }
    if (e === 'workers_progress') {
      setPipelineStatus({ stage: 'analyzing', detail: `Similarity ${p.similarity_done || 0}/${p.similarity_total || '?'} · Gaps ${p.future_done > 0 ? '✓' : '…'}` })
    }
    if (e === 'worker_complete' && p.worker_type === 'similarity') {
      setPipelineStatus({ stage: 'analyzing', detail: `"${p.paper_title?.slice(0, 40) || ''}" — ${Math.round((p.similarity_score || 0) * 100)}% match` })
    }
    if (e === 'gap_found') {
      setPipelineStatus({ stage: 'analyzing', detail: `Gap found: "${p.gap_title?.slice(0, 40) || ''}"` })
    }
    if (e === 'worker_complete' && p.worker_type === 'future_research') {
      setPipelineStatus({ stage: 'analyzing', detail: `${p.gaps_found || 0} research gaps extracted` })
    }
    if (e === 'reconciler_started' || e === 'deduplicating_gaps') {
      setPipelineStatus({ stage: 'building', detail: 'Merging & deduplicating gaps…' })
    }
    if (e === 'graph_ready') {
      clearInterval(pollRef.current)
      if (targetLocale !== 'en') {
        // Non-English: graph exists in English but translation is about to start.
        // Don't show the English graph — wait for graph_translated to call refetch().
        setPipelineStatus({ stage: 'translating', detail: `${p.node_count || ''} nodes ready · translating…` })
      } else {
        setPipelineStatus({ stage: 'building', detail: `${p.node_count || ''} nodes · ${p.edge_count || ''} edges` })
        refetch()
      }
    }
    if (e === 'translation_started') {
      setPipelineStatus({ stage: 'translating', detail: 'Translating graph…' })
    }
    if (e === 'translation_progress') {
      setPipelineStatus({ stage: 'translating', detail: `${p.done_fields || 0}/${p.total_fields || '?'} fields` })
    }
    if (e === 'graph_translated') {
      setPipelineStatus({ stage: 'done', detail: 'Translation complete' })
      refetch()
    }
    if (e === 'search_results') {
      setSearchResults(p.papers || [])
      setPipelineStatus(null)
    }
    if (e === 'pdf_translation_started') {
      const loc = p.target_locale
      inProgressPdfLocaleRef.current = loc
      setPdfTranslations(prev => ({ ...prev, [loc]: { status: 'translating', page: 0, total: p.total_pages || 0, url: p.html_url || null } }))
      setActivePdfLocale(loc)
    }
    if (e === 'pdf_translation_progress') {
      const loc = inProgressPdfLocaleRef.current
      if (loc) setPdfTranslations(prev => {
        const cur = prev[loc]
        if (!cur) return prev
        return { ...prev, [loc]: { ...cur, page: p.page || 0, total: p.total_pages || cur.total } }
      })
    }
    if (e === 'pdf_translation_done') {
      const loc = p.target_locale
      inProgressPdfLocaleRef.current = null
      setPdfTranslations(prev => ({ ...prev, [loc]: { status: 'done', page: p.total_pages, total: p.total_pages, url: p.html_url } }))
      setActivePdfLocale(loc)
    }
    if (e === 'pdf_translation_error') {
      const loc = p.target_locale || inProgressPdfLocaleRef.current
      inProgressPdfLocaleRef.current = null
      if (loc) setPdfTranslations(prev => ({ ...prev, [loc]: { status: 'error', page: 0, total: 0, url: null } }))
    }
    if (e === 'error') {
      setPipelineStatus({ stage: 'error', detail: p.message || 'Something went wrong' })
      clearInterval(pollRef.current)
    }
  }, [events, targetLocale])

  // Clear status to 'done' when graph loads
  useEffect(() => {
    if (graph && pipelineStatus && pipelineStatus.stage !== 'translating') {
      setPipelineStatus({ stage: 'done', detail: `${graph.nodes?.length || 0} nodes · ${graph.edges?.length || 0} edges` })
    }
  }, [graph])

  // When graph updates (e.g. after translation), refresh selectedNode with translated data
  // so NodeDetailPanel shows translated content without requiring a re-click
  useEffect(() => {
    if (!graph || !selectedNodeRef.current) return
    const sel   = selectedNodeRef.current
    const fresh = graph.nodes?.find(n => n.id === sel.id)
    if (!fresh) return
    setSelectedNode({
      id:         fresh.id,
      label:      fresh.display_label || fresh.label,
      full_label: fresh.display_label || fresh.label,
      type:       fresh.type,
      nodeData:   fresh.data,
    })
  }, [graph])

  // Persist completed graph to localStorage (keyed per locale)
  useEffect(() => {
    if (graph && jobId) {
      saveJob(jobId, graph.seed_title || 'Analysis', targetLocale, graph)
    }
  }, [graph, jobId, targetLocale])

  // Auto-set pdfNode to seed paper when graph loads so PDF tab is immediately available
  useEffect(() => {
    if (!graph) return
    const seedNode = graph.nodes?.find(n => n.type === 'seed')
    if (seedNode) {
      setPdfNode({
        id:         seedNode.id,
        label:      seedNode.label,
        full_label: seedNode.display_label || seedNode.label,
        type:       seedNode.type,
        nodeData:   seedNode.data,
      })
    }
  }, [graph])

  // Reset PDF translation state when the user switches to a different paper
  useEffect(() => {
    setPdfTranslations({})
    setActivePdfLocale(null)
    inProgressPdfLocaleRef.current = null
  }, [pdfNode?.id])

  // locale is the locale the search/analysis was started with
  async function handleJobStart(newJobId, title, mode, locale) {
    // Auto-save previous job with graph snapshot to library before switching
    if (jobId && graph) {
      saveJob(jobId, graph.seed_title || 'Previous analysis', targetLocale, graph)
      try {
        await fetch(`${GATEWAY}/job/${jobId}`, { method: 'DELETE' })
      } catch {}
    }
    setJobId(newJobId)
    setRestoredGraph(null)
    setSelectedNode(null)
    setPdfNode(null)
    setPdfTranslations({})
    setActivePdfLocale(null)
    if (mode !== 'confirm') {
      setSearchResults([])
      // Reset locale to whatever was chosen for this search (English by default)
      setTargetLocale(locale || 'en')
    }
    setPipelineStatus({ stage: 'fetching', detail: 'Starting analysis…' })
    setView('graph')
    saveJob(newJobId, title, locale || 'en')
  }

  function handleRemoveJob(removedJobId) {
    removeJob(removedJobId)
    // If the currently active graph is the one being removed, clear the view
    if (removedJobId === jobId) {
      setJobId(null)
      setSelectedNode(null)
      setPdfNode(null)
      setPdfTranslations({})
      setActivePdfLocale(null)
      setPipelineStatus(null)
      setRestoredGraph(null)
      setView('graph')
    }
  }

  async function handleJobRestore(item) {
    setJobId(item.jobId)
    const snapshots = item.graphSnapshots || {}

    // If the current global locale already has a snapshot for this item, keep it.
    // Otherwise switch to the item's own seed locale.
    const chosenLocale = snapshots[targetLocale]
      ? targetLocale
      : (item.locale || Object.keys(snapshots)[0] || 'en')

    // Pick the best available snapshot to display immediately
    const snapshot = snapshots[chosenLocale] || snapshots.en || Object.values(snapshots)[0] || null

    setTargetLocale(chosenLocale)
    setRestoredGraph(snapshot)
    setSelectedNode(null)
    setPdfNode(null)
    setPipelineStatus(null)
    setView('graph')

    // If we need a translation and don't have a snapshot for it,
    // re-push the English graph to Redis so lingo-service can translate it.
    if (chosenLocale !== 'en' && !snapshots[chosenLocale] && snapshot) {
      try {
        await fetch(`${GATEWAY}/restore-graph`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            job_id:        item.jobId,
            graph:         snapshot,
            target_locale: chosenLocale,
          })
        })
      } catch {}
    }
  }

  async function handleLocaleChange(locale) {
    if (isPipelineRunning) { setPipelineBlock(true); return }
    setTargetLocale(locale)
    if (!jobId) return

    // Check local snapshot cache first — the graph may already be translated
    // and saved in localStorage from a previous session or earlier in this session.
    // If we have it, use it directly without any API call.
    const savedItem   = saved.find(s => s.jobId === jobId)
    const cachedGraph = savedItem?.graphSnapshots?.[locale]

    if (cachedGraph) {
      setRestoredGraph(cachedGraph)
      return
    }

    if (locale === 'en') return

    // Not cached locally — trigger translation via backend
    try {
      const resp = await fetch(`${GATEWAY}/translate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ job_id: jobId, target_locale: locale })
      })
      // Graph expired from Redis — re-push English base and queue translation
      if (resp.status === 404 && graph) {
        await fetch(`${GATEWAY}/restore-graph`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ job_id: jobId, graph, target_locale: locale })
        })
      }
    } catch {}
  }

  // Called by SearchPanel when non-English script is detected in the query
  function handleLocaleDetected(locale, proceedFn) {
    setLocaleModal({ locale, proceedFn })
  }

  function handleNodeSelect(nodeData) {
    setSelectedNode(nodeData)
    // Always allow PDF for seed paper; also enable for any node with a PDF/arXiv URL
    if (nodeData?.type === 'seed' || nodeData?.nodeData?.arxiv_url || nodeData?.nodeData?.pdf_url) {
      setPdfNode(nodeData)
    }
  }

  function handleViewPdf(nodeData) {
    setPdfNode(nodeData || selectedNode)
    setView('pdf')
  }

  async function handleTranslatePdf(locale) {
    if (isPipelineRunning) { setPipelineBlock(true); return }
    const chosenLocale = locale || targetLocale
    if (!jobId || chosenLocale === 'en') return

    // Already translated or in-progress for this locale — just switch to it
    const existing = pdfTranslations[chosenLocale]
    if (existing && existing.status !== 'error') {
      setActivePdfLocale(chosenLocale)
      return
    }

    const seedData = pdfNode?.nodeData || graph?.nodes?.find(n => n.type === 'seed')?.data
    const pdfFallback = seedData?.pdf_url?.replace('arxiv.org/pdf/', 'arxiv.org/abs/')
    const arxivUrl = seedData?.arxiv_url || pdfFallback
    if (!arxivUrl) return

    setPdfTranslations(prev => ({ ...prev, [chosenLocale]: { status: 'translating', page: 0, total: 0, url: null } }))
    setActivePdfLocale(chosenLocale)
    try {
      await fetch(`${GATEWAY}/translate-pdf`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ job_id: jobId, arxiv_url: arxivUrl, target_locale: chosenLocale })
      })
    } catch {
      setPdfTranslations(prev => ({ ...prev, [chosenLocale]: { status: 'error', page: 0, total: 0, url: null } }))
    }
  }

  return (
    <div className={`flex flex-col h-screen overflow-hidden ${dk ? 'bg-slate-950' : 'bg-gray-50'}`}>

      {/* Pipeline block dialog — shown when user tries to translate while graph is building */}
      {pipelineBlock && (
        <PipelineBlockModal theme={theme} onDismiss={() => setPipelineBlock(false)} />
      )}

      {/* Styled toast notification */}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} theme={theme} />}

      {/* Centered language modal — blocks UI until user responds */}
      {localeModal && (
        <LanguageCenterModal
          locale={localeModal.locale}
          theme={theme}
          onAccept={() => {
            localeModal.proceedFn(localeModal.locale)
            setLocaleModal(null)
          }}
          onDismiss={() => {
            localeModal.proceedFn('en')
            setLocaleModal(null)
          }}
        />
      )}

      <TopBar
        jobId={jobId}
        graph={graph}
        targetLocale={targetLocale}
        onLocaleChange={handleLocaleChange}
        theme={theme}
        onToggleTheme={toggleTheme}
        isPipelineRunning={isPipelineRunning}
        onError={(msg) => showToast(msg, 'error')}
      />

      {pipelineStatus && <StatusBanner status={pipelineStatus} theme={theme} />}

      <div className="flex flex-1 overflow-hidden">

        {/* Left */}
        <div className={`w-72 shrink-0 border-r flex flex-col overflow-hidden
                          ${dk ? 'border-white/8 bg-slate-900' : 'border-gray-200 bg-white'}`}>
          <div className="flex-1 overflow-hidden flex flex-col">
            <SearchPanel
              onJobStart={handleJobStart}
              onLocaleDetected={handleLocaleDetected}
              targetLocale={targetLocale}
              searchResults={searchResults}
              theme={theme}
              isPipelineRunning={isPipelineRunning}
            />
          </div>
          <SavedSearches
            saved={saved}
            onJobRestore={handleJobRestore}
            onRemoveJob={handleRemoveJob}
            currentJobId={jobId}
            theme={theme}
          />
        </div>

        {/* Center — graph or PDF */}
        <div className="flex-1 overflow-hidden flex flex-col">

          {/* Graph / PDF toggle tabs */}
          {jobId && (
            <div className={`flex items-center gap-1 px-4 py-2 border-b ${dk ? 'border-white/8' : 'border-gray-200'}`}>
              {['graph', 'pdf'].map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  disabled={v === 'pdf' && !pdfNode}
                  className={`px-3 py-1 rounded-lg text-sm font-medium capitalize transition-colors
                               disabled:opacity-30 disabled:cursor-not-allowed
                               ${view === v
                                 ? dk ? 'bg-white/10 text-white' : 'bg-gray-900 text-white'
                                 : dk ? 'text-slate-400 hover:text-slate-200' : 'text-gray-500 hover:text-gray-700'
                               }`}
                >
                  {v === 'pdf' ? (pdfNode ? `PDF: ${pdfNode.full_label?.slice(0, 20) || 'Paper'}…` : 'PDF') : 'Graph'}
                </button>
              ))}
              {pdfNode?.nodeData?.arxiv_url && (
                <a
                  href={pdfNode.nodeData.arxiv_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`ml-auto text-xs ${dk ? 'text-slate-500 hover:text-slate-300' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  Open in arXiv ↗
                </a>
              )}
            </div>
          )}

          <div className="flex-1 overflow-hidden p-3">
            {view === 'graph' || !jobId ? (
              <KnowledgeGraph
                elements={elements}
                onNodeSelect={handleNodeSelect}
                loading={loading || (!!jobId && !graph && !!pipelineStatus && pipelineStatus.stage !== 'error')}
                pipelineStatus={pipelineStatus}
                theme={theme}
                onViewPdf={handleViewPdf}
                selectedNodeForPdf={pdfNode}
              />
            ) : (
              <PdfViewer
                key={pdfNode?.id}
                node={pdfNode}
                theme={theme}
                targetLocale={targetLocale}
                pdfTranslations={pdfTranslations}
                activePdfLocale={activePdfLocale}
                onSetActivePdfLocale={setActivePdfLocale}
                onTranslate={handleTranslatePdf}
                onPipelineBlock={() => setPipelineBlock(true)}
                isPipelineRunning={isPipelineRunning}
                gatewayUrl={GATEWAY}
              />
            )}
          </div>
        </div>

        {/* Right */}
        <div className={`w-80 shrink-0 border-l overflow-hidden
                          ${dk ? 'border-white/8 bg-slate-900' : 'border-gray-200 bg-white'}`}>
          <NodeDetailPanel node={selectedNode} jobId={jobId} theme={theme} />
        </div>

      </div>

      <EventFeed events={events} connected={connected} theme={theme} />
    </div>
  )
}

// ── Locale name map ───────────────────────────────────────────────────────────
const LOCALE_NAMES = {
  hi: 'Hindi', es: 'Spanish', fr: 'French', pt: 'Portuguese',
  zh: 'Chinese', ja: 'Japanese', ar: 'Arabic', de: 'German',
  it: 'Italian', ko: 'Korean', ru: 'Russian', nl: 'Dutch',
  tr: 'Turkish', pl: 'Polish', sv: 'Swedish', da: 'Danish',
  fi: 'Finnish', no: 'Norwegian', cs: 'Czech', ro: 'Romanian',
  uk: 'Ukrainian', bn: 'Bengali', ur: 'Urdu', vi: 'Vietnamese',
  id: 'Indonesian', ms: 'Malay', th: 'Thai',
}

// ── Centered language modal — appears before search runs ──────────────────────
function LanguageCenterModal({ locale, theme, onAccept, onDismiss }) {
  const dk       = theme === 'dark'
  const langName = LOCALE_NAMES[locale] || locale.toUpperCase()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 ${dk ? 'bg-black/70' : 'bg-black/40'}`}
        onClick={onDismiss}
      />
      {/* Modal card */}
      <div className={`relative z-10 rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl
                        ${dk ? 'bg-slate-900 border border-white/10' : 'bg-white border border-gray-200'}`}>
        <div className="text-center">
          <div className="text-4xl mb-4">🌐</div>
          <h2 className={`text-lg font-semibold mb-2 ${dk ? 'text-white' : 'text-gray-900'}`}>
            {langName} detected
          </h2>
          <p className={`text-sm mb-6 leading-relaxed ${dk ? 'text-slate-400' : 'text-gray-500'}`}>
            Your query appears to be in {langName}. Would you like search results
            and the knowledge graph translated to {langName}?
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={onAccept}
              className={`w-full px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors
                           ${dk ? 'bg-sky-500 text-white hover:bg-sky-400' : 'bg-sky-600 text-white hover:bg-sky-500'}`}
            >
              Yes, translate to {langName}
            </button>
            <button
              onClick={onDismiss}
              className={`w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-colors
                           ${dk
                             ? 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                             : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'}`}
            >
              Keep in English
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Pipeline block modal ──────────────────────────────────────────────────────
function PipelineBlockModal({ theme, onDismiss }) {
  const dk = theme === 'dark'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className={`absolute inset-0 ${dk ? 'bg-black/70' : 'bg-black/40'}`} onClick={onDismiss} />
      <div className={`relative z-10 rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl
                        ${dk ? 'bg-slate-900 border border-white/10' : 'bg-white border border-gray-200'}`}>
        <div className="text-center">
          <div className="text-4xl mb-4">⏳</div>
          <h2 className={`text-lg font-semibold mb-2 ${dk ? 'text-white' : 'text-gray-900'}`}>
            Graph is being built
          </h2>
          <p className={`text-sm mb-6 leading-relaxed ${dk ? 'text-slate-400' : 'text-gray-500'}`}>
            This can be done after the graph is ready. Please wait for the analysis to complete.
          </p>
          <button
            onClick={onDismiss}
            className={`w-full px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors
                         ${dk ? 'bg-sky-500 text-white hover:bg-sky-400' : 'bg-sky-600 text-white hover:bg-sky-500'}`}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Toast notification ────────────────────────────────────────────────────────
function Toast({ toast, onClose, theme }) {
  const dk = theme === 'dark'

  const variants = {
    error:   { border: 'border-red-500/30',     bg: dk ? 'bg-red-500/12'     : 'bg-red-50',     text: dk ? 'text-red-300'     : 'text-red-700',     icon: '✕', iconBg: dk ? 'bg-red-500/20'     : 'bg-red-100'     },
    success: { border: 'border-emerald-500/30', bg: dk ? 'bg-emerald-500/12' : 'bg-emerald-50', text: dk ? 'text-emerald-300' : 'text-emerald-700', icon: '✓', iconBg: dk ? 'bg-emerald-500/20' : 'bg-emerald-100' },
    warning: { border: 'border-amber-500/30',   bg: dk ? 'bg-amber-500/12'   : 'bg-amber-50',   text: dk ? 'text-amber-300'   : 'text-amber-700',   icon: '!', iconBg: dk ? 'bg-amber-500/20'   : 'bg-amber-100'   },
    info:    { border: 'border-sky-500/30',     bg: dk ? 'bg-sky-500/12'     : 'bg-sky-50',     text: dk ? 'text-sky-300'     : 'text-sky-700',     icon: 'i', iconBg: dk ? 'bg-sky-500/20'     : 'bg-sky-100'     },
  }
  const v = variants[toast.type] || variants.info

  return (
    <div
      className="fixed bottom-6 right-6 z-[9999] animate-[slide-in-right_0.3s_ease]"
      style={{ animation: 'slideUp 0.3s cubic-bezier(0.34,1.56,0.64,1) both' }}
    >
      <style>{`@keyframes slideUp { from{opacity:0;transform:translateY(16px) scale(.96)} to{opacity:1;transform:translateY(0) scale(1)} }`}</style>
      <div className={`flex items-start gap-3 px-4 py-3.5 rounded-2xl border shadow-2xl max-w-xs ${v.bg} ${v.border}`}>
        <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 ${v.iconBg} ${v.text}`}>
          {v.icon}
        </span>
        <p className={`text-sm leading-snug flex-1 ${v.text}`}>{toast.msg}</p>
        <button
          onClick={onClose}
          className={`shrink-0 text-xs leading-none mt-0.5 opacity-50 hover:opacity-100 transition-opacity ${v.text}`}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

// ── PDF Viewer ────────────────────────────────────────────────────────────────
// arXiv blocks direct iframes — we route through PDF.js (Mozilla CDN).
// When a translated PDF is ready, we serve it from our own gateway instead.
const LOCALE_NAMES_PDF = {
  hi: 'Hindi', es: 'Spanish', fr: 'French', pt: 'Portuguese',
  zh: 'Chinese', ja: 'Japanese', ar: 'Arabic', de: 'German',
  it: 'Italian', ko: 'Korean', ru: 'Russian', nl: 'Dutch',
  tr: 'Turkish', pl: 'Polish', sv: 'Swedish', da: 'Danish',
  fi: 'Finnish', no: 'Norwegian', cs: 'Czech', ro: 'Romanian',
  uk: 'Ukrainian', bn: 'Bengali', ur: 'Urdu', vi: 'Vietnamese',
  id: 'Indonesian', ms: 'Malay', th: 'Thai',
}

const PDF_LOCALES = [
  { code: 'hi', label: 'हिंदी',       flag: '🇮🇳' },
  { code: 'zh', label: '中文',        flag: '🇨🇳' },
  { code: 'ar', label: 'العربية',    flag: '🇸🇦' },
  { code: 'pt', label: 'Português',  flag: '🇧🇷' },
  { code: 'es', label: 'Español',    flag: '🇪🇸' },
  { code: 'fr', label: 'Français',   flag: '🇫🇷' },
  { code: 'de', label: 'Deutsch',    flag: '🇩🇪' },
  { code: 'ja', label: '日本語',      flag: '🇯🇵' },
  { code: 'ko', label: '한국어',      flag: '🇰🇷' },
  { code: 'ru', label: 'Русский',    flag: '🇷🇺' },
  { code: 'bn', label: 'বাংলা',       flag: '🇧🇩' },
]

function PdfViewer({ node, theme, targetLocale, pdfTranslations, activePdfLocale, onSetActivePdfLocale, onTranslate, onPipelineBlock, isPipelineRunning, gatewayUrl }) {
  const [showLangPicker, setShowLangPicker] = React.useState(false)
  const [showOriginal,   setShowOriginal]   = React.useState(false)

  // Reset "show original" toggle when paper or active locale changes
  React.useEffect(() => { setShowOriginal(false) }, [node?.id, activePdfLocale])

  const dk     = theme === 'dark'
  const arxiv  = node?.nodeData?.arxiv_url
  const pdfUrl = node?.nodeData?.pdf_url || (arxiv ? arxiv.replace('arxiv.org/abs/', 'arxiv.org/pdf/') : null)

  // Suggest the global locale for the translate button (non-English only)
  const suggestedLocale = targetLocale !== 'en' ? targetLocale : null

  // Active translation data
  const activeTr      = activePdfLocale ? pdfTranslations[activePdfLocale] : null
  const isTranslating = activeTr?.status === 'translating'
  const isDone        = activeTr?.status === 'done'
  const isError       = activeTr?.status === 'error'

  const translatedHtmlUrl = activeTr?.url ? `${gatewayUrl}${activeTr.url}` : null

  const pdfJsUrl = pdfUrl
    ? `https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(pdfUrl)}`
    : null

  const viewerUrl   = (showOriginal || !translatedHtmlUrl) ? pdfJsUrl : translatedHtmlUrl
  const isSandboxed = !translatedHtmlUrl || showOriginal

  const progress = activeTr?.total > 0
    ? Math.round((activeTr.page / activeTr.total) * 100)
    : null

  const translatedLocales   = Object.keys(pdfTranslations)
  const untranslatedLocales = PDF_LOCALES.filter(l => !pdfTranslations[l.code])

  function handleTranslateClick(locale) {
    setShowLangPicker(false)
    if (isPipelineRunning) { onPipelineBlock(); return }
    onTranslate(locale)
  }

  function handleLocaleTabClick(locale) {
    onSetActivePdfLocale(locale)
    setShowOriginal(false)
  }

  function handleExportPdf() {
    if (!activeTr?.url) return
    // /translated/{job}/{arxiv}/{locale} → /export-pdf/{job}/{arxiv}/{locale}
    const exportUrl = `${gatewayUrl}${activeTr.url.replace('/translated/', '/export-pdf/')}`
    window.open(exportUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className={`w-full h-full rounded-2xl overflow-hidden flex flex-col
                      ${dk ? 'border border-white/8' : 'border border-gray-200'}`}>

      {/* Toolbar */}
      <div className={`flex items-center gap-3 px-4 py-2 border-b shrink-0 relative
                        ${dk ? 'bg-slate-800 border-white/8' : 'bg-white border-gray-200'}`}>
        <p className={`text-xs truncate flex-1 ${dk ? 'text-slate-400' : 'text-gray-500'}`}>
          {node?.full_label || node?.label || 'Paper PDF'}
        </p>

        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">

          {/* Language tabs: Original + each translated locale */}
          {translatedLocales.length > 0 && (
            <div className={`flex items-center rounded-lg overflow-hidden border text-xs shrink-0
                              ${dk ? 'border-white/10' : 'border-gray-200'}`}>
              <button
                onClick={() => { onSetActivePdfLocale(null); setShowOriginal(true) }}
                className={`px-2.5 py-1 transition-colors
                             ${showOriginal || !activePdfLocale
                               ? dk ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-800'
                               : dk ? 'text-slate-400 hover:bg-white/5' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                Original
              </button>
              {translatedLocales.map(loc => {
                const tr     = pdfTranslations[loc]
                const name   = LOCALE_NAMES_PDF[loc] || loc.toUpperCase()
                const active = activePdfLocale === loc && !showOriginal
                return (
                  <button
                    key={loc}
                    onClick={() => handleLocaleTabClick(loc)}
                    className={`px-2.5 py-1 transition-colors flex items-center gap-1
                                 ${active
                                   ? dk ? 'bg-sky-500/20 text-sky-300' : 'bg-sky-50 text-sky-700'
                                   : dk ? 'text-slate-400 hover:bg-white/5' : 'text-gray-500 hover:bg-gray-50'}`}
                  >
                    {tr?.status === 'translating' && (
                      <svg className="w-2.5 h-2.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                    )}
                    {tr?.status === 'done' ? `✓ ${name}` : name}
                  </button>
                )
              })}
            </div>
          )}

          {/* Translate PDF button — only when untranslated locales remain */}
          {untranslatedLocales.length > 0 && (
            <div className="relative">
              {suggestedLocale && !pdfTranslations[suggestedLocale] ? (
                <button
                  onClick={() => handleTranslateClick(suggestedLocale)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors
                               ${dk
                                 ? 'bg-sky-500/15 border border-sky-500/30 text-sky-300 hover:bg-sky-500/25'
                                 : 'bg-sky-50 border border-sky-200 text-sky-700 hover:bg-sky-100'}`}
                >
                  🌐 Translate to {LOCALE_NAMES_PDF[suggestedLocale] || suggestedLocale}
                </button>
              ) : (
                <button
                  onClick={() => setShowLangPicker(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors
                               ${dk
                                 ? 'bg-white/8 border border-white/12 text-slate-300 hover:bg-white/12'
                                 : 'bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100'}`}
                >
                  🌐 {translatedLocales.length > 0 ? 'Add language' : 'Translate PDF'}
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                  </svg>
                </button>
              )}

              {showLangPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowLangPicker(false)} />
                  <div className={`absolute right-0 top-full mt-1 w-44 rounded-xl shadow-xl z-50 overflow-hidden
                                    ${dk ? 'bg-slate-800 border border-white/10' : 'bg-white border border-gray-200'}`}>
                    {untranslatedLocales.map(l => (
                      <button
                        key={l.code}
                        onClick={() => handleTranslateClick(l.code)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors
                                     ${dk ? 'text-slate-300 hover:bg-white/8' : 'text-gray-700 hover:bg-gray-50'}`}
                      >
                        <span>{l.flag}</span>
                        <span>{l.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Progress badge for the active in-progress translation */}
          {isTranslating && (
            <div className={`flex items-center gap-2 px-3 py-1 rounded-lg text-xs
                              ${dk ? 'bg-amber-500/10 border border-amber-500/20 text-amber-300'
                                   : 'bg-amber-50 border border-amber-200 text-amber-700'}`}>
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              {progress !== null ? `Page ${activeTr.page}/${activeTr.total} · ${progress}%` : 'Starting…'}
            </div>
          )}

          {isError && <span className="text-xs text-red-400">Translation failed</span>}

          {/* Export PDF — opens translated HTML in browser print mode */}
          {isDone && (
            <button
              onClick={handleExportPdf}
              title="Download as PDF via browser print dialog"
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors
                           ${dk
                             ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
                             : 'bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100'}`}
            >
              ⬇ Export PDF
            </button>
          )}

          {/* Open in new tab */}
          {(translatedHtmlUrl || pdfUrl) && (
            <a href={showOriginal ? pdfUrl : (translatedHtmlUrl || pdfUrl)} target="_blank" rel="noopener noreferrer"
               className={`text-xs px-3 py-1 rounded-lg border transition-colors
                            ${dk ? 'border-white/10 text-slate-300 hover:bg-white/8'
                                 : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              Open ↗
            </a>
          )}
        </div>
      </div>

      {/* Thin progress bar during active translation */}
      {isTranslating && (
        <div className={`h-0.5 shrink-0 ${dk ? 'bg-white/5' : 'bg-gray-100'}`}>
          <div
            className="h-full bg-sky-500 transition-all duration-700 ease-out"
            style={{ width: progress !== null ? `${progress}%` : '5%' }}
          />
        </div>
      )}

      {viewerUrl ? (
        <iframe
          key={viewerUrl}
          src={viewerUrl}
          className="flex-1 w-full"
          title="Paper PDF"
          {...(isSandboxed && { sandbox: "allow-scripts allow-same-origin allow-popups allow-forms" })}
        />
      ) : (
        <div className={`flex-1 flex items-center justify-center
                          ${dk ? 'bg-slate-900' : 'bg-gray-50'}`}>
          <p className={`text-sm ${dk ? 'text-slate-500' : 'text-gray-400'}`}>No PDF available</p>
        </div>
      )}
    </div>
  )
}
