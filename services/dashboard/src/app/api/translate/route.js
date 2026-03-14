import { LingoDotDevEngine } from 'lingo.dev/sdk'

export async function POST(request) {
    const apiKey = process.env.LINGODOTDEV_API_KEY
    if (!apiKey) {
        const { payload } = await request.json()
        return Response.json({ result: payload })  // return original, no crash
    }

    const engine = new LingoDotDevEngine({ apiKey })
    const { type, payload, sourceLocale, targetLocale } = await request.json()

    try {
        let result

        if (type === 'text') {
        result = await engine.localizeText(payload, { sourceLocale, targetLocale, fast: true})
        } else if (type === 'object') {
        result = await engine.localizeObject(payload, { sourceLocale, targetLocale, fast: true })
        } else if (type === 'chat') {
        result = await engine.localizeChat(payload, { sourceLocale, targetLocale, fast: true })
        }

        return Response.json({ result })
    } catch (e) {
        return Response.json({ result: payload, error: e.message }, { status: 200 })
        // return original on failure — never break the UI
    }
}