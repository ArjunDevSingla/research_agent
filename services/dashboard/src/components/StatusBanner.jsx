/**
 * StatusBanner — shows what the pipeline is doing right now.
 * Appears between TopBar and main content while analysis is running.
 * Disappears when done or on error.
 */
'use client'

const STAGE_CONFIG = {
  fetching:    { color: 'bg-blue-50 border-blue-200 text-blue-700',   icon: '📄', spin: true  },
  analyzing:   { color: 'bg-indigo-50 border-indigo-200 text-indigo-700', icon: '🔍', spin: true  },
  building:    { color: 'bg-purple-50 border-purple-200 text-purple-700', icon: '◈',  spin: true  },
  translating: { color: 'bg-orange-50 border-orange-200 text-orange-700', icon: '🌐', spin: true  },
  done:        { color: 'bg-green-50 border-green-200 text-green-700',  icon: '✓',  spin: false },
  error:       { color: 'bg-red-50 border-red-200 text-red-700',       icon: '✗',  spin: false },
}

const STAGE_LABEL = {
  fetching:    'Fetching paper',
  analyzing:   'Analyzing',
  building:    'Building graph',
  translating: 'Translating',
  done:        'Complete',
  error:       'Error',
}

export default function StatusBanner({ status, theme = "dark" }) {
  const dk = theme === "dark"
  if (!status) return null

  const config = STAGE_CONFIG[status.stage] || STAGE_CONFIG.fetching

  return (
    <div className={`flex items-center gap-3 px-5 py-2.5 border-b text-sm ${config.color}`}>

      {/* Spinner or icon */}
      {config.spin ? (
        <div className="flex items-center gap-2">
          <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin opacity-60" />
          <span className="font-medium">{STAGE_LABEL[status.stage]}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span>{config.icon}</span>
          <span className="font-medium">{STAGE_LABEL[status.stage]}</span>
        </div>
      )}

      {/* Separator */}
      <span className="opacity-40">·</span>

      {/* Detail */}
      <span className="opacity-80">{status.detail}</span>

      {/* Stage dots */}
      <div className="ml-auto flex items-center gap-1.5">
        {['fetching', 'analyzing', 'building', 'done'].map((s) => (
          <div
            key={s}
            className={`w-1.5 h-1.5 rounded-full transition-all ${
              s === status.stage
                ? 'bg-current opacity-100 scale-125'
                : isBeforeStage(s, status.stage)
                  ? 'bg-current opacity-40'
                  : 'bg-current opacity-10'
            }`}
          />
        ))}
      </div>

    </div>
  )
}

const STAGE_ORDER = ['fetching', 'analyzing', 'building', 'translating', 'done']

function isBeforeStage(stage, current) {
  return STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf(current)
}