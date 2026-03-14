/**
 * components/TopBar.jsx
 * Top bar — language switcher, graph stats, export button.
 */
'use client'
import { useState } from 'react'

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8000'

const LOCALES = [
  { code: 'en', label: 'English',    flag: '🇬🇧' },
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

export default function TopBar({ jobId, graph, targetLocale, onLocaleChange, theme = "dark", onToggleTheme }) {
  const dk = theme === "dark"
  const [exporting,    setExporting]    = useState(false)
  const [showLocales,  setShowLocales]  = useState(false)

  const nodeCount = graph?.nodes?.length || 0
  const edgeCount = graph?.edges?.length || 0
  const gapCount  = graph?.nodes?.filter(n => n.type === 'future_gap').length || 0

  const currentLocale = LOCALES.find(l => l.code === targetLocale) || LOCALES[0]

  async function handleExport() {
    if (!jobId) return
    setExporting(true)
    try {
      const resp = await fetch(`${GATEWAY}/export/${jobId}`)
      if (!resp.ok) throw new Error('Export failed')
      const blob = await resp.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `paperswarm-${jobId}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className={`flex items-center justify-between px-5 py-3 border-b ${dk ? "border-white/8 bg-slate-900" : "border-gray-200 bg-white"}`}>

      {/* Left — graph stats */}
      <div className="flex items-center gap-4">
        {graph ? (
          <>
            <Stat label="papers" value={nodeCount - gapCount} color="text-blue-600" />
            <Stat label="gaps"   value={gapCount}             color="text-purple-600" />
            <Stat label="edges"  value={edgeCount}            color="text-gray-500" />
          </>
        ) : (
          <span className="text-xs text-gray-400 font-mono">
            {jobId ? `job · ${jobId}` : 'No active analysis'}
          </span>
        )}
      </div>

      {/* Right — theme + locale + export */}
      <div className="flex items-center gap-3">

        {/* Theme toggle */}
        <button
          onClick={onToggleTheme}
          className={`p-1.5 rounded-lg border transition-colors text-sm
                       ${dk ? "border-white/10 text-slate-400 hover:bg-white/8 hover:text-slate-200"
                             : "border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-700"}`}
          title={dk ? "Switch to light theme" : "Switch to dark theme"}
        >
          {dk ? "☀" : "🌙"}
        </button>

        {/* Language switcher */}
        <div className="relative">
          <button
            onClick={() => setShowLocales(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-paper-border
                       rounded-lg bg-white hover:bg-paper transition-colors"
          >
            <span>{currentLocale.flag}</span>
            <span className="text-gray-600">{currentLocale.label}</span>
            <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
            </svg>
          </button>

          {showLocales && (
            <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-paper-border
                            rounded-xl shadow-float z-50 overflow-hidden">
              {LOCALES.map(locale => (
                <button
                  key={locale.code}
                  onClick={() => {
                    onLocaleChange(locale.code)
                    setShowLocales(false)
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm
                              hover:bg-paper transition-colors text-left
                              ${locale.code === targetLocale ? 'bg-accent/5 text-accent font-medium' : 'text-gray-700'}`}
                >
                  <span>{locale.flag}</span>
                  <span>{locale.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Export PDF */}
        <button
          onClick={handleExport}
          disabled={!jobId || exporting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                     bg-ink text-white rounded-lg hover:bg-ink-light
                     disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {exporting ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
          )}
          Export PDF
        </button>
      </div>

      {/* Click-outside to close locale picker */}
      {showLocales && (
        <div className="fixed inset-0 z-40" onClick={() => setShowLocales(false)} />
      )}
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className={`text-sm font-mono font-medium ${color}`}>{value}</span>
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  )
}