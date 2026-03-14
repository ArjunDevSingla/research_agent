/**
 * lib/eventTranslator.js
 *
 * Dashboard-side event translation using Lingo.dev browser SDK.
 *
 * Option B approach:
 *   - All ws_events arrive from backend in English instantly (no latency)
 *   - Dashboard translates human-readable parts inline using browser SDK
 *   - localize_text() for single strings, localize_object() for payloads
 *   - Non-human-readable fields (event type, job_id, counts) never translated
 *   - Falls back to English if SDK call fails — event still shows up
 *   - Researcher sees events in their language with ~0 perceived delay
 *     because translation is async and the event renders immediately in
 *     English then swaps to translated text once SDK responds (~100-200ms)
 *
 * Usage:
 *   import { translateEvent } from './eventTranslator'
 *
 *   socket.onmessage = async (raw) => {
 *     const event   = JSON.parse(raw.data)
 *     const translated = await translateEvent(event, targetLocale)
 *     renderEvent(translated)
 *   }
 */

// Add this helper instead:
async function translate(type, payload, sourceLocale, targetLocale) {
  if (targetLocale === 'en') return payload
  try {
    const resp = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload, sourceLocale, targetLocale })
    })
    const data = await resp.json()
    return data.result ?? payload
  } catch {
    return payload
  }
}

// ── Engine singleton ──────────────────────────────────────────────────────────
// One engine instance shared across all translation calls in the browser.
// Re-created if locale changes.

let _engine     = null
let _lastLocale = null

// ── Event human-readable field map ───────────────────────────────────────────
// Defines which fields in each event payload are human-readable
// and should be translated. Everything else is left as-is.

const TRANSLATABLE_PAYLOAD_FIELDS = {
  // Similarity worker events
  similarity_result_ready: ['explanation', 'connection_description'],

  // Future research worker events
  gap_found:               ['gap_title', 'description', 'still_open_aspects'],

  // Reconciler events
  reconciler_started:      [],
  deduplicating_gaps:      [],
  graph_ready:             [],

  // Translation events
  translation_started:     [],
  translation_progress:    ['label'],
  graph_translated:        [],

  // Error events
  error:                   ['message'],

  // Generic progress
  planner_started:         [],
  similarity_started:      [],
  future_research_started: [],
}

// Human-readable status messages per event type
// These are the "headline" shown in the live feed
const EVENT_MESSAGES = {
  planner_started:         'Analyzing paper and fetching related work...',
  similarity_started:      'Starting similarity analysis...',
  similarity_result_ready: 'Found a related paper',
  future_research_started: 'Reading paper for research gaps...',
  gap_found:               'Research gap identified',
  deduplicating_gaps:      'Merging duplicate gaps...',
  reconciler_started:      'Building knowledge graph...',
  graph_ready:             'Knowledge graph complete',
  translation_started:     'Translating results...',
  translation_progress:    'Translating...',
  graph_translated:        'Translation complete',
  error:                   'Something went wrong',
}


// ── Core translation function ─────────────────────────────────────────────────

/**
 * translateEvent(event, targetLocale, apiKey)
 *
 * Takes a raw ws_event from the backend and returns a translated copy.
 *
 * Steps:
 *   1. Extract the human-readable headline message for this event type
 *   2. Extract translatable payload fields
 *   3. Call Lingo.dev localize_object() on { headline, ...payload_fields }
 *   4. Return enriched event with all translated fields added
 *
 * The original English fields are preserved alongside translated ones
 * so nothing breaks if translation is partial.
 *
 * @param {object} event        - Raw event from WebSocket { event, job_id, payload, timestamp }
 * @param {string} targetLocale - BCP47 locale code e.g. "hi", "pt", "ar"
 * @param {string} apiKey       - Lingo.dev API key
 * @returns {object}            - Event with translated fields added
 */
export async function translateEvent(event, targetLocale, apiKey) {
  // Always return original immediately — translation is additive
  if (!targetLocale || targetLocale === 'en' || !apiKey) {
    return enrichWithMessage(event)
  }

  const eventType = event.event
  const payload   = event.payload || {}

  // Build the object to translate
  // Always include the headline message + any translatable payload fields
  const toTranslate = {}

  // Headline message for this event type
  const headline = EVENT_MESSAGES[eventType]
  if (headline) {
    toTranslate['__headline'] = headline
  }

  // Translatable payload fields for this event type
  const translatableFields = TRANSLATABLE_PAYLOAD_FIELDS[eventType] || []
  for (const field of translatableFields) {
    const value = payload[field]
    if (!value) continue

    // still_open_aspects is an array — join for translation
    if (Array.isArray(value)) {
      toTranslate[field] = value.join(' ||| ')
    } else if (typeof value === 'string') {
      toTranslate[field] = value
    }
  }

  // Nothing to translate
  if (Object.keys(toTranslate).length === 0) {
    return enrichWithMessage(event)
  }

  try {
    const translated = await translate('object', obj, 'en', locale)

    // Build translated event — original fields preserved, translated added
    const translatedPayload = { ...payload }

    // Apply translated payload fields
    for (const field of translatableFields) {
      const tValue = translated[field]
      if (!tValue) continue

      if (Array.isArray(payload[field])) {
        // Restore array
        translatedPayload[`translated_${field}`] = tValue
          .split('|||')
          .map(s => s.trim())
          .filter(Boolean)
      } else {
        translatedPayload[`translated_${field}`] = tValue
      }
    }

    return {
      ...event,
      payload:              translatedPayload,
      translated_headline:  translated['__headline'] || headline,
      original_headline:    headline,
      translated:           true,
      target_locale:        targetLocale,
    }

  } catch (err) {
    console.warn(`[EventTranslator] Translation failed for '${eventType}':`, err)
    // Fallback — return original event with English headline
    return enrichWithMessage(event)
  }
}


/**
 * translateFullPdf(pdfText, targetLocale, apiKey, onChunk)
 *
 * Translate an entire PDF's text content using localize_text()
 * with sequential progress so the dashboard can show a progress bar
 * and render translated pages as they arrive (not wait for all).
 *
 * Called when researcher clicks "Translate entire paper" in PDF viewer.
 *
 * @param {string}   pdfText      - Full extracted text of the PDF
 * @param {string}   targetLocale - Target language code
 * @param {string}   apiKey       - Lingo.dev API key
 * @param {function} onChunk      - Callback(translatedChunk, progress) called per batch
 * @returns {string}              - Full translated text
 */
export async function translateFullPdf(pdfText, targetLocale, apiKey, onChunk) {
  if (!targetLocale || targetLocale === 'en' || !apiKey) {
    return pdfText
  }

  // Split into pages/sections for granular progress
  const pages        = splitIntoPages(pdfText)
  const totalPages   = pages.length
  let   translated   = []
  let   donePages    = 0

  try {

    // Translate page by page so researcher sees content filling in
    // rather than waiting for the entire document
    for (const page of pages) {
      const result = await translate('text', text, 'en', locale)

      translated.push(result)
      donePages++

      // Notify dashboard of progress + give it the translated page
      if (onChunk) {
        onChunk(result, {
          done:    donePages,
          total:   totalPages,
          pct:     Math.round(donePages / totalPages * 100),
        })
      }
    }

    return translated.join('\n\n')

  } catch (err) {
    console.warn('[EventTranslator] PDF translation failed:', err)
    return pdfText
  }
}


/**
 * translateSelectedText(text, targetLocale, apiKey, context)
 *
 * Translate a user-selected paragraph from the PDF viewer.
 * Uses localize_chat() for context-aware translation — better quality
 * for dense research prose than plain localize_text().
 *
 * Context is the surrounding paragraph so the model understands
 * what came before and after the selection.
 *
 * @param {string} text         - Selected text
 * @param {string} targetLocale - Target language
 * @param {string} apiKey       - Lingo.dev API key
 * @param {object} context      - { before, after } surrounding text
 * @returns {string}            - Translated text
 */
export async function translateSelectedText(text, targetLocale, apiKey, context = {}) {
  if (!targetLocale || targetLocale === 'en' || !apiKey) {
    return text
  }

  try {

    // Build chat context — localize_chat() preserves meaning
    // across consecutive selections in the same paper
    const messages = []

    if (context.before) {
      messages.push({ role: 'assistant', content: context.before })
    }

    messages.push({ role: 'user', content: text })

    const result = await translate('chat', messages, 'en', locale)

    // localize_chat returns array of messages — get the last one
    const lastMessage = result[result.length - 1]
    return lastMessage?.content || text

  } catch (err) {
    console.warn('[EventTranslator] Selected text translation failed:', err)
    return text
  }
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function enrichWithMessage(event) {
  return {
    ...event,
    translated_headline: EVENT_MESSAGES[event.event] || event.event,
    original_headline:   EVENT_MESSAGES[event.event] || event.event,
    translated:          false,
  }
}

function splitIntoPages(text, charsPerPage = 3000) {
  const pages = []
  for (let i = 0; i < text.length; i += charsPerPage) {
    pages.push(text.slice(i, i + charsPerPage))
  }
  return pages
}


// ── Language change handler ───────────────────────────────────────────────────

/**
 * onLanguageChange(newLocale)
 *
 * Called when researcher switches language in the dashboard.
 * Resets engine so next call uses fresh locale context.
 */
export function onLanguageChange(newLocale) {
  _engine     = null
  _lastLocale = newLocale
  console.log(`[EventTranslator] Language changed to: ${newLocale}`)
}
