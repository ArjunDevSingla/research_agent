'use client'
import { useState } from 'react'

function groupElements(elements) {
  const nodes  = elements.filter(e => e.data.type)
  const seed   = nodes.find(n => n.data.type === 'seed')
  const papers = nodes.filter(n => n.data.type === 'similar_paper')
  const gaps   = nodes.filter(n => n.data.type === 'future_gap')
  return { seed, papers, gaps }
}

function scoreColor(score) {
  if (score >= 0.75) return { border: '#10b981', glow: 'rgba(16,185,129,0.3)', bar: '#10b981', text: '#10b981' }
  if (score >= 0.50) return { border: '#f59e0b', glow: 'rgba(245,158,11,0.3)',  bar: '#f59e0b', text: '#f59e0b' }
  return                     { border: '#ef4444', glow: 'rgba(239,68,68,0.25)', bar: '#ef4444', text: '#ef4444' }
}

const GAP_COLORS = {
  open:             { bg: 'rgba(239,68,68,0.12)',    border: '#ef4444', badge: '#fca5a5', text: '#fca5a5',   label: 'Open' },
  partially_solved: { bg: 'rgba(245,158,11,0.12)',   border: '#f59e0b', badge: '#fcd34d', text: '#fcd34d',   label: 'Partial' },
  solved:           { bg: 'rgba(16,185,129,0.12)',   border: '#10b981', badge: '#6ee7b7', text: '#6ee7b7',   label: 'Solved' },
}
const GAP_COLORS_LIGHT = {
  open:             { bg: '#fef2f2', border: '#fca5a5', badge: '#ef4444', text: '#dc2626', label: 'Open' },
  partially_solved: { bg: '#fffbeb', border: '#fde68a', badge: '#f59e0b', text: '#d97706', label: 'Partial' },
  solved:           { bg: '#f0fdf4', border: '#bbf7d0', badge: '#10b981', text: '#059669', label: 'Solved' },
}

// ── Flip card ─────────────────────────────────────────────────────────────────
function FlipCard({ front, back, selected, onClick, borderColor, glowColor, theme }) {
  const [flipped, setFlipped] = useState(false)
  const dk = theme === 'dark'

  return (
    <div
      className="relative cursor-pointer select-none"
      style={{ width: '200px', height: '120px', perspective: '1000px' }}
      onMouseEnter={() => setFlipped(true)}
      onMouseLeave={() => setFlipped(false)}
      onClick={onClick}
    >
      <div
        className="relative w-full h-full transition-transform duration-500"
        style={{
          transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* Front */}
        <div
          className="absolute inset-0 rounded-2xl p-4 flex flex-col justify-between"
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            background: dk
              ? `linear-gradient(135deg, rgba(30,41,59,0.9), rgba(15,23,42,0.95))`
              : `linear-gradient(135deg, #ffffff, #f8fafc)`,
            border: `1.5px solid ${selected ? '#f59e0b' : borderColor}`,
            boxShadow: selected
              ? `0 0 0 2px #f59e0b40, 0 8px 24px ${glowColor}`
              : `0 4px 16px ${glowColor}`,
            backdropFilter: 'blur(12px)',
          }}
        >
          {front}
        </div>
        {/* Back */}
        <div
          className="absolute inset-0 rounded-2xl p-3 flex flex-col justify-center overflow-hidden"
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            background: dk
              ? `linear-gradient(135deg, rgba(15,23,42,0.98), rgba(30,41,59,0.98))`
              : `linear-gradient(135deg, #f8fafc, #f1f5f9)`,
            border: `1.5px solid ${borderColor}`,
            boxShadow: `0 8px 28px ${glowColor}`,
            backdropFilter: 'blur(16px)',
          }}
        >
          {back}
        </div>
      </div>
    </div>
  )
}

// ── Seed card (no flip — always full info) ────────────────────────────────────
function SeedCard({ node, selected, onClick, theme }) {
  const d  = node.data.nodeData || {}
  const dk = theme === 'dark'
  return (
    <div
      onClick={() => onClick(node.data)}
      className="cursor-pointer select-none rounded-2xl p-5 w-80 mx-auto transition-all duration-300"
      style={{
        background: dk
          ? 'linear-gradient(135deg, rgba(14,165,233,0.12), rgba(15,23,42,0.95))'
          : 'linear-gradient(135deg, #f0f9ff, #ffffff)',
        border: `2px solid ${selected ? '#f59e0b' : '#38bdf8'}`,
        boxShadow: selected
          ? '0 0 0 3px rgba(245,158,11,0.3), 0 12px 40px rgba(56,189,248,0.3)'
          : '0 8px 32px rgba(56,189,248,0.2)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border
                          ${dk ? 'bg-sky-500/15 text-sky-300 border-sky-500/30' : 'bg-sky-50 text-sky-700 border-sky-200'}`}>
          Seed Paper
        </span>
        {d.year && <span className={`text-xs ${dk ? 'text-slate-500' : 'text-gray-400'}`}>{d.year}</span>}
      </div>
      <h3 className={`text-sm font-semibold leading-snug mb-2 line-clamp-3 ${dk ? 'text-white' : 'text-gray-900'}`}>
        {node.data.full_label || node.data.label}
      </h3>
      {d.authors?.length > 0 && (
        <p className={`text-xs truncate ${dk ? 'text-slate-400' : 'text-gray-500'}`}>
          {d.authors.slice(0, 2).join(', ')}
        </p>
      )}
      <p className={`text-xs mt-2 ${dk ? 'text-sky-400' : 'text-sky-600'}`}>Click for details →</p>
    </div>
  )
}

// ── Paper flip card ───────────────────────────────────────────────────────────
function PaperCard({ node, selected, onClick, theme, index }) {
  const d     = node.data.nodeData || {}
  const score = d.similarity_score || 0
  const pct   = Math.round(score * 100)
  const col   = scoreColor(score)
  const dk    = theme === 'dark'

  const front = (
    <>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-mono font-bold" style={{ color: col.text }}>{pct}%</span>
          <div className="flex-1 mx-2 h-1 rounded-full overflow-hidden" style={{ background: dk ? 'rgba(255,255,255,0.08)' : '#e5e7eb' }}>
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: col.bar }} />
          </div>
        </div>
        <p className={`text-xs font-medium leading-snug line-clamp-2 ${dk ? 'text-slate-200' : 'text-gray-800'}`}>
          {node.data.full_label || node.data.label}
        </p>
      </div>
      <div>
        {d.authors?.[0] && <p className={`text-xs truncate ${dk ? 'text-slate-500' : 'text-gray-400'}`}>{d.authors[0]}</p>}
        {d.year && <p className={`text-xs ${dk ? 'text-slate-600' : 'text-gray-300'}`}>{d.year}</p>}
      </div>
    </>
  )

  const back = (
    <div className="h-full flex flex-col justify-between">
      {(d.translated_explanation || d.explanation) ? (
        <>
          <p className={`text-xs font-semibold mb-1 ${dk ? 'text-slate-400' : 'text-gray-500'}`}>Why similar</p>
          <p className={`text-xs leading-relaxed line-clamp-4 flex-1 ${dk ? 'text-slate-300' : 'text-gray-700'}`}>{d.translated_explanation || d.explanation}</p>
        </>
      ) : (d.translated_abstract || d.abstract) ? (
        <p className={`text-xs leading-relaxed line-clamp-5 ${dk ? 'text-slate-300' : 'text-gray-700'}`}>{d.translated_abstract || d.abstract}</p>
      ) : null}
      <p className={`text-xs mt-1 ${dk ? 'text-blue-400' : 'text-blue-600'}`}>Click for full details →</p>
    </div>
  )

  return (
    <div style={{ animationDelay: `${index * 50}ms` }} className="animate-fadeIn">
      <FlipCard
        front={front}
        back={back}
        selected={selected}
        onClick={() => onClick(node.data)}
        borderColor={col.border}
        glowColor={col.glow}
        theme={theme}
      />
    </div>
  )
}

// ── Gap flip card ─────────────────────────────────────────────────────────────
function GapCard({ node, selected, onClick, theme, index }) {
  const d      = node.data.nodeData || {}
  const status = d.status || 'open'
  const pct    = Math.round((d.confidence || 0) * 100)
  const col    = theme === 'dark' ? (GAP_COLORS[status] || GAP_COLORS.open) : (GAP_COLORS_LIGHT[status] || GAP_COLORS_LIGHT.open)
  const dk     = theme === 'dark'
  const src    = d.translated_source_paper || d.source_paper || d.compared_with || ''
  const srcShort = src.length > 28 ? src.slice(0, 28) + '…' : src

  const front = (
    <>
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold border"
                style={{ background: col.bg, borderColor: col.border, color: col.text }}>
            {col.label}
          </span>
          <span className="text-xs font-mono font-bold" style={{ color: col.text }}>{pct}%</span>
        </div>
        <p className={`text-xs font-medium leading-snug line-clamp-2 ${dk ? 'text-slate-200' : 'text-gray-800'}`}>
          {node.data.full_label || node.data.label}
        </p>
      </div>
      {srcShort && (
        <p className="text-xs truncate" style={{ color: dk ? 'rgba(167,139,250,0.7)' : '#7c3aed' }}>
          ← {srcShort}
        </p>
      )}
    </>
  )

  const back = (
    <div className="h-full flex flex-col justify-between">
      {(d.translated_gap_description || d.gap_description) ? (
        <>
          <p className={`text-xs font-semibold mb-1 ${dk ? 'text-slate-400' : 'text-gray-500'}`}>Why this gap</p>
          <p className={`text-xs leading-relaxed line-clamp-4 flex-1 ${dk ? 'text-slate-300' : 'text-gray-700'}`}>{d.translated_gap_description || d.gap_description}</p>
        </>
      ) : null}
      {srcShort && <p className="text-xs mt-1" style={{ color: dk ? '#a78bfa' : '#7c3aed' }}>From: {srcShort}</p>}
      <p className={`text-xs mt-1 ${dk ? 'text-purple-400' : 'text-purple-600'}`}>Click for full details →</p>
    </div>
  )

  return (
    <div style={{ animationDelay: `${index * 50}ms` }} className="animate-fadeIn">
      <FlipCard
        front={front}
        back={back}
        selected={selected}
        onClick={() => onClick(node.data)}
        borderColor={col.border}
        glowColor={theme === 'dark' ? 'rgba(167,139,250,0.25)' : 'rgba(124,58,237,0.15)'}
        theme={theme}
      />
    </div>
  )
}

function SectionDivider({ label, count, theme }) {
  const dk = theme === 'dark'
  return (
    <div className="flex items-center gap-3 w-full mb-5">
      <div className={`h-px flex-1 ${dk ? 'bg-white/8' : 'bg-gray-200'}`} />
      <span className={`text-xs font-bold uppercase tracking-widest px-3 ${dk ? 'text-slate-500' : 'text-gray-400'}`}>
        {label} <span className={`font-mono ml-1 ${dk ? 'text-slate-600' : 'text-gray-300'}`}>{count}</span>
      </span>
      <div className={`h-px flex-1 ${dk ? 'bg-white/8' : 'bg-gray-200'}`} />
    </div>
  )
}

function Connector({ theme }) {
  const dk = theme === 'dark'
  return (
    <div className="flex flex-col items-center -my-3 z-10">
      <div className={`w-px h-8 ${dk ? 'bg-gradient-to-b from-white/15 to-white/5' : 'bg-gradient-to-b from-gray-300 to-gray-200'}`} />
    </div>
  )
}

export default function KnowledgeGraph({ elements, onNodeSelect, loading, pipelineStatus, theme = 'dark', onViewPdf, selectedNodeForPdf }) {
  const [selectedId, setSelectedId] = useState(null)
  const dk = theme === 'dark'

  function handleSelect(nodeData) {
    const newId = nodeData?.id || null
    setSelectedId(prev => prev === newId ? null : newId)
    onNodeSelect?.(nodeData)
  }

  if (loading) {
    return (
      <div className={`w-full h-full flex items-center justify-center rounded-2xl
                        ${dk ? 'bg-gradient-to-br from-slate-950 to-slate-900' : 'bg-gray-50 border border-gray-200'}`}>
        <div className="text-center">
          <div className="relative w-14 h-14 mx-auto mb-5">
            <div className={`absolute inset-0 border-2 rounded-full animate-ping ${dk ? 'border-sky-500/20' : 'border-sky-300/40'}`} />
            <div className={`absolute inset-0 border-2 border-t-transparent rounded-full animate-spin ${dk ? 'border-sky-400' : 'border-sky-500'}`} />
          </div>
          <p className={`text-sm font-light ${dk ? 'text-slate-400' : 'text-gray-500'}`}>
            {pipelineStatus?.detail || 'Building knowledge graph…'}
          </p>
          <p className={`text-xs mt-1 ${dk ? 'text-slate-600' : 'text-gray-400'}`}>~15–30 seconds</p>
        </div>
      </div>
    )
  }

  if (!elements.length) {
    return (
      <div className={`w-full h-full flex items-center justify-center rounded-2xl
                        ${dk ? 'bg-gradient-to-br from-slate-950 to-slate-900' : 'bg-gray-50 border border-gray-200'}`}>
        <div className="text-center">
          <div className={`w-20 h-20 mx-auto mb-5 rounded-3xl flex items-center justify-center text-3xl
                            ${dk ? 'bg-slate-800/60 border border-white/8' : 'bg-white border border-gray-200 shadow-sm'}`}>◈</div>
          <p className={`text-sm font-light ${dk ? 'text-slate-400' : 'text-gray-500'}`}>No graph yet</p>
          <p className={`text-xs mt-1 ${dk ? 'text-slate-600' : 'text-gray-400'}`}>Try arXiv ID: 2010.11929</p>
        </div>
      </div>
    )
  }

  const { seed, papers, gaps } = groupElements(elements)
  const sortedPapers = [...papers].sort((a, b) => (b.data.nodeData?.similarity_score || 0) - (a.data.nodeData?.similarity_score || 0))
  const sortedGaps   = [...gaps].sort((a, b) => (b.data.nodeData?.confidence || 0) - (a.data.nodeData?.confidence || 0))

  return (
    <div className={`w-full h-full rounded-2xl overflow-auto flex flex-col items-center gap-8 p-8 relative
                      ${dk ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950' : 'bg-gray-50'}`}>
      {dk && (
        <div className="fixed inset-0 pointer-events-none opacity-[0.02]"
             style={{ backgroundImage: 'radial-gradient(circle, #94a3b8 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
      )}

      {seed && (
        <div className="w-full flex flex-col items-center">
          <SectionDivider label="Seed Paper" count={1} theme={theme} />
          <SeedCard node={seed} selected={selectedId === seed.data.id} onClick={handleSelect} theme={theme} />
        </div>
      )}

      {seed && papers.length > 0 && <Connector theme={theme} />}

      {papers.length > 0 && (
        <div className="w-full">
          <SectionDivider label="Related Papers" count={papers.length} theme={theme} />
          <div className="flex flex-wrap gap-4 justify-center">
            {sortedPapers.map((node, i) => (
              <PaperCard key={node.data.id} node={node} index={i}
                         selected={selectedId === node.data.id} onClick={handleSelect} theme={theme} />
            ))}
          </div>
        </div>
      )}

      {papers.length > 0 && gaps.length > 0 && <Connector theme={theme} />}

      {gaps.length > 0 && (
        <div className="w-full pb-6">
          <SectionDivider label="Research Gaps" count={gaps.length} theme={theme} />
          <div className="flex flex-wrap gap-4 justify-center">
            {sortedGaps.map((node, i) => (
              <GapCard key={node.data.id} node={node} index={i}
                       selected={selectedId === node.data.id} onClick={handleSelect} theme={theme} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}