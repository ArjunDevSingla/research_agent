'use client'
import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'

import SearchPanel     from '../components/SearchPanel'
import NodeDetailPanel from '../components/NodeDetailPanel'
import EventFeed       from '../components/EventFeed'
import TopBar          from '../components/TopBar'
import StatusBanner    from '../components/StatusBanner'
import SavedSearches, { useSavedSearches } from '../components/SavedSearches'

import { useWebSocket } from '../hooks/useWebSocket'
import { useGraph }     from '../hooks/useGraph'

const KnowledgeGraph = dynamic(
  () => import('../components/KnowledgeGraph'),
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
  const pollRef = useRef(null)

  const dk = theme === 'dark'

  const { saved, saveJob }            = useSavedSearches()
  const { events, connected }         = useWebSocket(jobId, targetLocale)
  const { graph, elements, loading, refetch } = useGraph(jobId)

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
          setPipelineStatus({ stage: 'done', detail: 'Graph ready' })
          refetch()
          clearInterval(pollRef.current)
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
  }, [jobId, graph])

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
      setPipelineStatus({ stage: 'building', detail: `${p.node_count || ''} nodes · ${p.edge_count || ''} edges` })
      clearInterval(pollRef.current)
      refetch()
    }
    if (e === 'translation_started') {
      setPipelineStatus({ stage: 'translating', detail: 'Translating graph…' })
    }
    if (e === 'translation_progress') {
      setPipelineStatus({ stage: 'translating', detail: `${p.done || 0}/${p.total || '?'} fields` })
    }
    if (e === 'graph_translated') {
      setPipelineStatus({ stage: 'done', detail: 'Translation complete' })
      refetch()
    }
    if (e === 'search_results') {
      setSearchResults(p.papers || [])
      setPipelineStatus(null)
    }
    if (e === 'error') {
      setPipelineStatus({ stage: 'error', detail: p.message || 'Something went wrong' })
      clearInterval(pollRef.current)
    }
  }, [events])

  // Clear status to 'done' when graph loads
  useEffect(() => {
    if (graph && pipelineStatus && pipelineStatus.stage !== 'translating') {
      setPipelineStatus({ stage: 'done', detail: `${graph.nodes?.length || 0} nodes · ${graph.edges?.length || 0} edges` })
    }
  }, [graph])

  function handleJobStart(newJobId, title, mode) {
    // Auto-save previous job to library before switching
    if (jobId && graph) {
      saveJob(jobId, graph.seed_title || 'Previous analysis', targetLocale)
    }
    setJobId(newJobId)
    setSelectedNode(null)
    // Only clear search results if this is a direct analyze (not a search result click)
    if (mode !== 'confirm') {
      setSearchResults([])
    }
    setPipelineStatus({ stage: 'fetching', detail: 'Starting analysis…' })
    setView('graph')
    saveJob(newJobId, title, targetLocale)
  }

  function handleJobRestore(restoredJobId) {
    setJobId(restoredJobId)
    setSelectedNode(null)
    setPipelineStatus(null)
    setView('graph')
  }

  async function handleLocaleChange(locale) {
    setTargetLocale(locale)
    if (!jobId) return
    try {
      // Request re-translation
      await fetch(`${GATEWAY}/translate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ job_id: jobId, target_locale: locale })
      })
    } catch {}
  }

  function handleNodeSelect(nodeData) {
    setSelectedNode(nodeData)
    if (nodeData?.nodeData?.arxiv_url) {
      setPdfNode(nodeData)
    }
  }

  function handleViewPdf(nodeData) {
    setPdfNode(nodeData || selectedNode)
    setView('pdf')
  }

  return (
    <div className={`flex flex-col h-screen overflow-hidden ${dk ? 'bg-slate-950' : 'bg-gray-50'}`}>

      <TopBar
        jobId={jobId}
        graph={graph}
        targetLocale={targetLocale}
        onLocaleChange={handleLocaleChange}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {pipelineStatus && <StatusBanner status={pipelineStatus} theme={theme} />}

      <div className="flex flex-1 overflow-hidden">

        {/* Left */}
        <div className={`w-72 shrink-0 border-r flex flex-col overflow-hidden
                          ${dk ? 'border-white/8 bg-slate-900' : 'border-gray-200 bg-white'}`}>
          <div className="flex-1 overflow-hidden flex flex-col">
            <SearchPanel
              onJobStart={handleJobStart}
              targetLocale={targetLocale}
              searchResults={searchResults}
              theme={theme}
            />
          </div>
          <SavedSearches
            onJobRestore={handleJobRestore}
            currentJobId={jobId}
            theme={theme}
          />
        </div>

        {/* Center — graph or PDF */}
        <div className="flex-1 overflow-hidden flex flex-col">

          {/* Graph / PDF toggle tabs — shown once a job is active */}
          {jobId && (
            <div className={`flex items-center gap-1 px-4 py-2 border-b ${dk ? 'border-white/8' : 'border-gray-200'}`}>
              {['graph', 'pdf'].map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  disabled={v === 'pdf' && !pdfNode?.nodeData?.arxiv_url}
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
              <PdfViewer node={pdfNode} theme={theme} />
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

// ── PDF viewer — arXiv blocks iframes so we use PDF.js viewer via CDN ──────────
function PdfViewer({ node, theme }) {
  const dk     = theme === 'dark'
  const arxiv  = node?.nodeData?.arxiv_url
  const pdfUrl = node?.nodeData?.pdf_url || (arxiv ? arxiv.replace('arxiv.org/abs/', 'arxiv.org/pdf/') : null)

  if (!pdfUrl) return (
    <div className={`w-full h-full flex items-center justify-center rounded-2xl
                      ${dk ? 'bg-slate-900' : 'bg-gray-50 border border-gray-200'}`}>
      <div className="text-center">
        <p className={`text-sm mb-3 ${dk ? 'text-slate-500' : 'text-gray-400'}`}>No PDF available</p>
      </div>
    </div>
  )

  // Use PDF.js viewer hosted on Mozilla CDN — works around arXiv iframe block
  const viewerUrl = `https://mozilla.github.io/pdf.js/web/viewer.html?file=${encodeURIComponent(pdfUrl)}`

  return (
    <div className={`w-full h-full rounded-2xl overflow-hidden flex flex-col
                      ${dk ? 'border border-white/8' : 'border border-gray-200'}`}>
      {/* Toolbar */}
      <div className={`flex items-center justify-between px-4 py-2 border-b shrink-0
                        ${dk ? 'bg-slate-800 border-white/8' : 'bg-white border-gray-200'}`}>
        <p className={`text-xs truncate max-w-xs ${dk ? 'text-slate-400' : 'text-gray-500'}`}>
          {node?.full_label || node?.label || 'Paper PDF'}
        </p>
        <div className="flex items-center gap-2">
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
             className={`text-xs px-3 py-1 rounded-lg border transition-colors
                          ${dk ? 'border-white/10 text-slate-300 hover:bg-white/8' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            Open in new tab ↗
          </a>
        </div>
      </div>
      <iframe
        src={viewerUrl}
        className="flex-1 w-full"
        title="Paper PDF"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
      />
    </div>
  )
}