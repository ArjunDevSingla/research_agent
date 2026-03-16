'use client'
import { useState, useEffect } from 'react'

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8000'

const GAP_STATUS = {
  open:             { label: 'Open',        dk: 'bg-red-500/15 text-red-300 border-red-500/40',         lt: 'bg-red-50 text-red-600 border-red-200' },
  partially_solved: { label: 'In Progress', dk: 'bg-amber-500/15 text-amber-300 border-amber-500/40',   lt: 'bg-amber-50 text-amber-600 border-amber-200' },
  solved:           { label: 'Solved',      dk: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', lt: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
}

// Notes stored per node: localStorage key = `note:{job_id}:{node_id}`
function useNote(jobId, nodeId) {
  const key = jobId && nodeId ? `note:${jobId}:${nodeId}` : null

  const [text, setText] = useState('')

  useEffect(() => {
    if (!key) return
    setText(localStorage.getItem(key) || '')
  }, [key])

  function save(value) {
    if (!key) return
    localStorage.setItem(key, value)
    setText(value)
  }

  return [text, save]
}

export default function NodeDetailPanel({ node, jobId, theme = 'dark' }) {
  const [showAllNotes, setShowAllNotes] = useState(false)
  const [allNotes,     setAllNotes]     = useState([])
  const [saved,        setSaved]        = useState(false)
  const [noteText,     saveNote]        = useNote(jobId, node?.id)
  const [draft,        setDraft]        = useState('')
  const dk = theme === 'dark'

  // Sync draft when node changes
  useEffect(() => { setDraft(noteText) }, [noteText])

  function handleSave() {
    if (!draft.trim() && !noteText) return
    saveNote(draft)
    // Also save to backend
    if (jobId && node?.id) {
      fetch(`${GATEWAY}/annotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, node_id: node.id, node_type: node.type, text: draft })
      }).catch(() => {})
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function loadAllNotes() {
    if (!jobId) return
    const notes = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(`note:${jobId}:`)) {
        const nodeId = k.replace(`note:${jobId}:`, '')
        const text   = localStorage.getItem(k)
        if (text?.trim()) notes.push({ nodeId, text })
      }
    }
    setAllNotes(notes)
    setShowAllNotes(true)
  }

  // All notes panel
  if (showAllNotes) {
    return (
      <div className="flex flex-col h-full">
        <div className={`flex items-center gap-3 px-5 py-4 border-b ${dk ? 'border-white/8' : 'border-gray-100'}`}>
          <button onClick={() => setShowAllNotes(false)}
                  className={`text-sm ${dk ? 'text-slate-400 hover:text-slate-200' : 'text-gray-500 hover:text-gray-700'}`}>
            ← Back
          </button>
          <h2 className={`text-sm font-semibold ${dk ? 'text-white' : 'text-gray-900'}`}>All Notes</h2>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {allNotes.length === 0 ? (
            <p className={`text-sm text-center py-8 ${dk ? 'text-slate-500' : 'text-gray-400'}`}>No notes yet</p>
          ) : allNotes.map((n, i) => (
            <div key={i} className={`p-3 rounded-xl border ${dk ? 'bg-slate-800/50 border-white/8' : 'bg-gray-50 border-gray-200'}`}>
              <p className={`text-xs font-mono mb-1.5 ${dk ? 'text-slate-600' : 'text-gray-400'}`}>{n.nodeId}</p>
              <p className={`text-sm leading-relaxed ${dk ? 'text-slate-300' : 'text-gray-700'}`}>{n.text}</p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!node) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8">
        <div className="text-4xl mb-3 opacity-20">◈</div>
        <p className={`text-sm text-center font-light ${dk ? 'text-slate-500' : 'text-gray-400'}`}>
          Click any card to see details
        </p>
        {jobId && (
          <button onClick={loadAllNotes}
                  className={`mt-6 text-xs px-3 py-1.5 rounded-lg border transition-colors
                               ${dk ? 'border-white/10 text-slate-400 hover:bg-white/5' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            View all notes
          </button>
        )}
      </div>
    )
  }

  const d    = node.nodeData || {}
  const type = node.type

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className={`px-5 pt-4 pb-3 border-b ${dk ? 'border-white/8' : 'border-gray-100'}`}>
        <div className="flex items-center justify-between mb-2">
          <NodeBadge type={type} dk={dk} />
          {jobId && (
            <button onClick={loadAllNotes}
                    className={`text-xs ${dk ? 'text-slate-500 hover:text-slate-300' : 'text-gray-400 hover:text-gray-600'}`}>
              All notes
            </button>
          )}
        </div>
        <h2 className={`font-semibold text-sm leading-snug ${dk ? 'text-white' : 'text-gray-900'}`}>
          {node.full_label || node.label}
        </h2>
        {d.year && <p className={`text-xs mt-0.5 ${dk ? 'text-slate-500' : 'text-gray-400'}`}>{d.year}</p>}
      </div>

      {/* Body */}
      <div className="flex-1 px-5 py-4 space-y-4 overflow-y-auto">

        {d.authors?.length > 0 && (
          <Section label="Authors" dk={dk}>
            <p className={`text-sm ${dk ? 'text-slate-300' : 'text-gray-700'}`}>{d.authors.join(', ')}</p>
          </Section>
        )}

        {d.similarity_score !== undefined && type === 'similar_paper' && (
          <Section label="Similarity" dk={dk}>
            <ScoreBar value={d.similarity_score} color="#3b82f6" dk={dk} />
          </Section>
        )}

        {(d.translated_explanation || d.explanation) && (
          <Section label="Why Similar" dk={dk}>
            <p className={`text-sm leading-relaxed ${dk ? 'text-slate-300' : 'text-gray-700'}`}>{d.translated_explanation || d.explanation}</p>
          </Section>
        )}

        {(d.translated_key_connections || d.key_connections)?.length > 0 && (
          <Section label="Key Connections" dk={dk}>
            <ul className="space-y-1">
              {(d.translated_key_connections || d.key_connections).map((c, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className={dk ? 'text-blue-400' : 'text-blue-500'}>›</span>
                  <span className={dk ? 'text-slate-300' : 'text-gray-700'}>{c}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {(d.translated_abstract || d.abstract) && (
          <Section label="Abstract" dk={dk}>
            <div className={`text-sm leading-relaxed max-h-44 overflow-y-auto pr-1
                              ${dk ? 'text-slate-400' : 'text-gray-600'}`}>
              {d.translated_abstract || d.abstract}
            </div>
          </Section>
        )}

        {/* Gap fields */}
        {type === 'future_gap' && (
          <>
            {d.status && (
              <Section label="Status" dk={dk}>
                <span className={`text-xs px-2.5 py-1 rounded-full border font-medium
                                  ${(GAP_STATUS[d.status] || GAP_STATUS.open)[dk ? 'dk' : 'lt']}`}>
                  {GAP_STATUS[d.status]?.label || d.status}
                </span>
              </Section>
            )}
            {d.confidence !== undefined && (
              <Section label="Confidence" dk={dk}>
                <ScoreBar value={d.confidence} color="#8b5cf6" dk={dk} />
              </Section>
            )}
            {(d.translated_gap_description || d.gap_description) && (
              <Section label="Description" dk={dk}>
                <p className={`text-sm leading-relaxed ${dk ? 'text-slate-300' : 'text-gray-700'}`}>
                  {(() => {
                    const desc = d.translated_gap_description || d.gap_description
                    if (typeof desc === 'string' && desc.trim().startsWith('['))
                      try { return JSON.parse(desc).map(g => g.description || g.gap_description || '').join(' • ') } catch {}
                    return desc
                  })()}
                </p>
              </Section>
            )}
            {(d.translated_source_paper || d.source_paper || d.compared_with) && (
              <Section label="Identified From" dk={dk}>
                <p className={`text-sm ${dk ? 'text-purple-300' : 'text-purple-700'}`}>
                  {d.translated_source_paper || d.source_paper || d.compared_with}
                </p>
              </Section>
            )}
            {(d.translated_still_open_aspects || d.still_open_aspects)?.length > 0 && (
              <Section label="Still Open" dk={dk}>
                <ul className="space-y-1">
                  {(d.translated_still_open_aspects || d.still_open_aspects).map((a, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className={dk ? 'text-purple-400' : 'text-purple-500'}>›</span>
                      <span className={dk ? 'text-slate-300' : 'text-gray-700'}>{a}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {(d.translated_research_questions || d.research_questions)?.length > 0 && (
              <Section label="Research Questions" dk={dk}>
                <ol className="space-y-1.5">
                  {(d.translated_research_questions || d.research_questions).map((q, i) => (
                    <li key={i} className={`text-sm leading-snug ${dk ? 'text-slate-400' : 'text-gray-600'}`}>
                      {i + 1}. {q}
                    </li>
                  ))}
                </ol>
              </Section>
            )}
          </>
        )}

        {d.pdf_url && (
          <a href={d.pdf_url} target="_blank" rel="noopener noreferrer"
             className={`inline-flex items-center gap-2 text-sm font-medium
                          ${dk ? 'text-sky-400 hover:text-sky-300' : 'text-sky-600 hover:text-sky-700'}`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
            </svg>
            Open PDF
          </a>
        )}

        {/* Note — per node */}
        <div className={`pt-3 border-t ${dk ? 'border-white/8' : 'border-gray-100'}`}>
          <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${dk ? 'text-slate-500' : 'text-gray-400'}`}>
            Your note
          </p>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Add a note about this paper…"
            rows={3}
            className={`w-full text-sm px-3 py-2 rounded-xl border resize-none
                         focus:outline-none focus:ring-2 transition-all
                         ${dk
                           ? 'bg-slate-800/60 border-white/10 text-slate-200 placeholder-slate-600 focus:border-sky-500/50 focus:ring-sky-500/10'
                           : 'bg-white border-gray-200 text-gray-800 placeholder-gray-300 focus:border-blue-300 focus:ring-blue-100'
                         }`}
          />
          <button onClick={handleSave}
                  className={`mt-2 px-4 py-1.5 text-sm rounded-xl font-medium transition-colors
                               ${dk ? 'bg-slate-700 text-slate-200 hover:bg-slate-600 border border-white/10'
                                    : 'bg-gray-900 text-white hover:bg-gray-700'}`}>
            {saved ? '✓ Saved' : 'Save note'}
          </button>
        </div>
      </div>
    </div>
  )
}

function NodeBadge({ type, dk }) {
  const s = {
    seed:          { dk: 'bg-sky-500/15 text-sky-300 border-sky-500/30',       lt: 'bg-sky-50 text-sky-700 border-sky-200',       l: 'Seed Paper' },
    similar_paper: { dk: 'bg-blue-500/15 text-blue-300 border-blue-500/30',    lt: 'bg-blue-50 text-blue-700 border-blue-200',    l: 'Related Paper' },
    future_gap:    { dk: 'bg-purple-500/15 text-purple-300 border-purple-500/30', lt: 'bg-purple-50 text-purple-700 border-purple-200', l: 'Research Gap' },
  }[type] || { dk: 'bg-gray-500/15 text-gray-300 border-gray-500/30', lt: 'bg-gray-50 text-gray-700 border-gray-200', l: type }
  return <span className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${dk ? s.dk : s.lt}`}>{s.l}</span>
}

function Section({ label, dk, children }) {
  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-wider mb-1.5 ${dk ? 'text-slate-500' : 'text-gray-400'}`}>{label}</p>
      {children}
    </div>
  )
}

function ScoreBar({ value, color, dk }) {
  const pct = Math.round((value || 0) * 100)
  return (
    <div className="flex items-center gap-3">
      <div className={`flex-1 h-2 rounded-full overflow-hidden ${dk ? 'bg-white/8' : 'bg-gray-100'}`}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-sm font-mono font-semibold w-10 text-right" style={{ color }}>{pct}%</span>
    </div>
  )
}