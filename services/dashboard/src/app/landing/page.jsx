'use client'
import React, { useState, useEffect, useRef, useCallback } from 'react'

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8000'

// ── Base content (English) ───────────────────────────────────────────────────
const BASE = {
  nav_launch:    'Launch App',
  hero_badge:    'Powered by AI · Translated by Lingo.dev',
  hero_title_1:  'Research at the',
  hero_title_2:  'speed of thought',
  hero_sub:      'PaperSwarm builds living knowledge graphs from arXiv papers, surfaces research gaps, and delivers insights in any language — instantly.',
  cta_primary:   'Launch App →',
  cta_secondary: 'View on GitHub',
  feat_heading:  'Everything you need to master the literature',
  f1_title: 'Knowledge Graphs',
  f1_body:  'Automatically synthesize citations, gaps, and connections across dozens of papers into a single interactive graph.',
  f2_title: 'Multi-Language AI',
  f2_body:  'Every node, edge, and annotation is translated in real-time by Lingo.dev — Arabic, Chinese, Hindi, and 20+ more.',
  f3_title: 'PDF Translation',
  f3_body:  'Translate full research PDFs page-by-page into beautifully formatted HTML with equations and figures preserved.',
  f4_title: 'Research Gaps',
  f4_body:  'LLMs analyze paper clusters to extract open, partially-solved, and solved research gaps with confidence scores.',
  how_label:  'How it works',
  how_title:  'From query to knowledge graph in minutes',
  s1_n: '01', s1_title: 'Search or paste arXiv ID',    s1_body: 'Start with a natural language query or paste an arXiv ID directly.',
  s2_n: '02', s2_title: 'Swarm analysis runs',          s2_body: 'Parallel AI workers fetch, compare, and analyze up to 20 related papers simultaneously.',
  s3_n: '03', s3_title: 'Graph appears live',           s3_body: 'A knowledge graph emerges — nodes, edges, and research gaps surface as they are discovered.',
  stat1_n: '20+',    stat1_l: 'Supported languages',
  stat2_n: '50+',    stat2_l: 'Papers per analysis',
  stat3_n: '< 2 min', stat3_l: 'Time to first insight',
  footer_tag: 'Open-source research intelligence · Built with love by researchers',
}

// ── Languages ────────────────────────────────────────────────────────────────
const LANGS = [
  { code:'en', label:'English',    flag:'🇺🇸' },
  { code:'zh', label:'中文',        flag:'🇨🇳' },
  { code:'ar', label:'العربية',    flag:'🇸🇦' },
  { code:'hi', label:'हिंदी',       flag:'🇮🇳' },
  { code:'es', label:'Español',    flag:'🇪🇸' },
  { code:'fr', label:'Français',   flag:'🇫🇷' },
  { code:'de', label:'Deutsch',    flag:'🇩🇪' },
  { code:'ja', label:'日本語',      flag:'🇯🇵' },
  { code:'ko', label:'한국어',      flag:'🇰🇷' },
  { code:'pt', label:'Português',  flag:'🇧🇷' },
  { code:'ru', label:'Русский',    flag:'🇷🇺' },
]

// ── Background graph data ─────────────────────────────────────────────────────
const NODES = [
  { x:12,  y:22,  r:1.4, type:'seed',  delay:0   },
  { x:28,  y:12,  r:0.9, type:'paper', delay:0.6 },
  { x:50,  y:18,  r:1.1, type:'paper', delay:1.2 },
  { x:72,  y:10,  r:0.8, type:'gap',   delay:0.3 },
  { x:88,  y:28,  r:1.0, type:'paper', delay:1.8 },
  { x:22,  y:48,  r:0.9, type:'paper', delay:0.9 },
  { x:42,  y:60,  r:1.4, type:'seed',  delay:0.4 },
  { x:65,  y:52,  r:0.9, type:'gap',   delay:1.5 },
  { x:84,  y:55,  r:1.1, type:'paper', delay:0.7 },
  { x:10,  y:75,  r:0.8, type:'paper', delay:1.1 },
  { x:33,  y:82,  r:0.9, type:'gap',   delay:0.2 },
  { x:55,  y:78,  r:0.8, type:'paper', delay:1.7 },
  { x:75,  y:82,  r:1.0, type:'paper', delay:0.5 },
  { x:92,  y:68,  r:0.8, type:'gap',   delay:1.3 },
  { x:48,  y:38,  r:0.7, type:'paper', delay:0.8 },
]
const EDGES = [[0,1],[0,2],[0,5],[1,2],[2,3],[2,14],[3,4],[4,8],[5,6],[6,7],[6,10],[7,8],[7,14],[8,13],[9,10],[10,11],[11,12],[12,13],[9,6],[14,7]]
const NCOLOR = { seed:'#38bdf8', paper:'#a78bfa', gap:'#34d399' }

export default function LandingPage() {
  const [locale,     setLocale]     = useState('en')
  const [content,    setContent]    = useState(BASE)
  const [loading,    setLoading]    = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [visible,    setVisible]    = useState({})
  const cacheRef    = useRef({})
  const sectionsRef = useRef({})

  // ── Translate via Lingo gateway ──────────────────────────────────────────
  const switchLocale = useCallback(async (code) => {
    setShowPicker(false)
    if (code === locale) return
    if (code === 'en')   { setLocale('en'); setContent(BASE); return }
    if (cacheRef.current[code]) { setLocale(code); setContent(cacheRef.current[code]); return }
    setLoading(true)
    try {
      const res  = await fetch(`${GATEWAY}/translate-ui`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content: BASE, locale: code }),
      })
      const data = await res.json()
      cacheRef.current[code] = data.translated
      setContent(data.translated)
      setLocale(code)
    } catch { /* keep current */ } finally { setLoading(false) }
  }, [locale])

  // ── Scroll-reveal ────────────────────────────────────────────────────────
  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => setVisible(v => ({ ...v, [e.target.id]: e.isIntersecting }))),
      { threshold: 0.12 }
    )
    Object.entries(sectionsRef.current).forEach(([, el]) => el && obs.observe(el))
    return () => obs.disconnect()
  }, [])

  const curLang = LANGS.find(l => l.code === locale) || LANGS[0]
  const isRtl   = ['ar', 'ur', 'he', 'fa'].includes(locale)

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      style={{ fontFamily:'system-ui,-apple-system,"Segoe UI","Noto Sans","Noto Sans Arabic","Noto Sans Devanagari","Noto Sans CJK SC","Hiragino Sans GB","Meiryo","Malgun Gothic",sans-serif', background:'#020617', color:'#f1f5f9' }}
    >
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        @keyframes float   { 0%,100%{transform:translateY(0)}  50%{transform:translateY(-10px)} }
        @keyframes gshift  { 0%{background-position:0% 50%}  50%{background-position:100% 50%}  100%{background-position:0% 50%} }
        @keyframes dashmov { to{stroke-dashoffset:-24} }
        @keyframes pulse   { 0%,100%{opacity:.4} 50%{opacity:1} }
        @keyframes spin    { to{transform:rotate(360deg)} }
        @keyframes fadeup  { from{opacity:0;transform:translateY(28px)} to{opacity:1;transform:translateY(0)} }
        @keyframes orb-drift { 0%{transform:translate(0,0)} 50%{transform:translate(30px,-20px)} 100%{transform:translate(0,0)} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        .grad-text {
          background: linear-gradient(120deg,#38bdf8 0%,#818cf8 35%,#c084fc 65%,#f472b6 100%);
          background-size:200% 200%; animation:gshift 5s ease infinite;
          -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
        }
        .card-hover { transition:transform .25s ease, box-shadow .25s ease; cursor:default }
        .card-hover:hover { transform:translateY(-6px) }
        .btn-primary { transition:transform .2s ease, box-shadow .2s ease }
        .btn-primary:hover { transform:translateY(-2px) }
        .btn-ghost   { transition:background .2s ease }
        .btn-ghost:hover  { background:rgba(255,255,255,0.1) !important }
        .lang-btn:hover { background:rgba(255,255,255,0.07) !important }
        .footer-flag { transition:transform .2s, opacity .2s }
        .footer-flag:hover { transform:scale(1.3) !important; opacity:1 !important }
        .section-reveal { opacity:0; transform:translateY(32px); transition:opacity .7s ease, transform .7s ease }
        .section-reveal.in { opacity:1; transform:translateY(0) }
        .edge-anim { stroke-dasharray:5 5; animation:dashmov 2.5s linear infinite }
        .node-float { animation:float 3.5s ease-in-out infinite }
        .spin-sm { display:inline-block; animation:spin .7s linear infinite }
        @media(max-width:600px){ .hero-h1{font-size:2.8rem!important} .cta-row{flex-direction:column} }
      `}</style>

      {/* ══════════ NAVBAR ══════════════════════════════════════════════════ */}
      <header style={{ position:'fixed', top:0, left:0, right:0, zIndex:200, background:'rgba(2,6,23,0.75)', backdropFilter:'blur(24px) saturate(180%)', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ maxWidth:1180, margin:'0 auto', padding:'0 24px', height:64, display:'flex', alignItems:'center', justifyContent:'space-between' }}>

          {/* Logo */}
          <a href="/landing" style={{ display:'flex', alignItems:'center', gap:10, textDecoration:'none' }}>
            <div style={{ width:34, height:34, borderRadius:9, background:'linear-gradient(135deg,#0ea5e9,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, boxShadow:'0 0 18px rgba(14,165,233,0.4)' }}>🐝</div>
            <span style={{ fontSize:18, fontWeight:800, color:'#f8fafc', letterSpacing:-0.5 }}>PaperSwarm</span>
          </a>

          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            {/* Language picker */}
            <div style={{ position:'relative' }}>
              <button
                onClick={() => setShowPicker(v => !v)}
                style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 13px', borderRadius:9, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'#cbd5e1', fontSize:13, cursor:'pointer' }}
                className="lang-btn"
              >
                {loading
                  ? <span className="spin-sm" style={{ width:14, height:14, border:'2px solid #38bdf8', borderTopColor:'transparent', borderRadius:'50%', display:'inline-block' }} />
                  : <span style={{ fontSize:17 }}>{curLang.flag}</span>
                }
                <span style={{ fontWeight:500 }}>{curLang.label}</span>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7"/></svg>
              </button>

              {showPicker && (
                <>
                  <div style={{ position:'fixed', inset:0, zIndex:49 }} onClick={() => setShowPicker(false)} />
                  <div style={{ position:'absolute', right:0, top:'calc(100% + 6px)', background:'#0d1830', border:'1px solid rgba(255,255,255,0.1)', borderRadius:14, overflow:'hidden', boxShadow:'0 24px 70px rgba(0,0,0,0.7)', zIndex:50, minWidth:170 }}>
                    {LANGS.map(l => (
                      <button
                        key={l.code}
                        onClick={() => switchLocale(l.code)}
                        style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'10px 16px', background: l.code === locale ? 'rgba(56,189,248,0.1)' : 'transparent', border:'none', color: l.code === locale ? '#38bdf8' : '#cbd5e1', fontSize:13, cursor:'pointer', textAlign:'left' }}
                        className="lang-btn"
                      >
                        <span style={{ fontSize:18 }}>{l.flag}</span>
                        <span>{l.label}</span>
                        {l.code === locale && <span style={{ marginLeft:'auto', color:'#38bdf8', fontSize:12 }}>✓</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* CTA */}
            <a
              href="/"
              style={{ padding:'9px 20px', borderRadius:10, background:'linear-gradient(135deg,#0ea5e9,#8b5cf6)', color:'#fff', fontSize:13, fontWeight:700, textDecoration:'none', boxShadow:'0 4px 22px rgba(14,165,233,0.35)', letterSpacing:-0.2 }}
              className="btn-primary"
            >
              {content.nav_launch}
            </a>
          </div>
        </div>
      </header>

      {/* ══════════ HERO ════════════════════════════════════════════════════ */}
      <section style={{ minHeight:'100vh', position:'relative', overflow:'hidden', display:'flex', alignItems:'center', paddingTop:64 }}>

        {/* Ambient grid */}
        <div style={{ position:'absolute', inset:0, backgroundImage:'linear-gradient(rgba(14,165,233,0.035) 1px,transparent 1px),linear-gradient(90deg,rgba(14,165,233,0.035) 1px,transparent 1px)', backgroundSize:'64px 64px', pointerEvents:'none' }} />

        {/* Glow orbs */}
        <div style={{ position:'absolute', top:'15%', left:'8%', width:700, height:700, borderRadius:'50%', background:'radial-gradient(ellipse,rgba(14,165,233,0.14) 0%,transparent 65%)', animation:'orb-drift 12s ease-in-out infinite', pointerEvents:'none' }} />
        <div style={{ position:'absolute', bottom:'5%', right:'3%', width:600, height:600, borderRadius:'50%', background:'radial-gradient(ellipse,rgba(139,92,246,0.14) 0%,transparent 65%)', animation:'orb-drift 16s ease-in-out infinite reverse', pointerEvents:'none' }} />
        <div style={{ position:'absolute', top:'45%', right:'30%', width:350, height:350, borderRadius:'50%', background:'radial-gradient(ellipse,rgba(52,211,153,0.07) 0%,transparent 65%)', pointerEvents:'none' }} />

        {/* Animated graph background */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"
          style={{ position:'absolute', inset:0, width:'100%', height:'100%', opacity:0.28, pointerEvents:'none' }}>
          <defs>
            <filter id="glow"><feGaussianBlur stdDeviation="0.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <linearGradient id="edge-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.6"/>
              <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.3"/>
            </linearGradient>
          </defs>

          {EDGES.map(([a,b], i) => (
            <line key={i}
              x1={NODES[a].x} y1={NODES[a].y} x2={NODES[b].x} y2={NODES[b].y}
              stroke={NCOLOR[NODES[a].type]} strokeWidth="0.12" strokeOpacity="0.45"
              className="edge-anim"
              style={{ animationDelay:`${i * 0.12}s` }}
            />
          ))}

          {NODES.map((n, i) => (
            <g key={i} className="node-float" style={{ animationDuration:`${3 + (i % 5) * 0.4}s`, animationDelay:`${n.delay}s`, transformOrigin:`${n.x}px ${n.y}px` }}>
              <circle cx={n.x} cy={n.y} r={n.r * 3.5} fill={NCOLOR[n.type]} opacity="0.05"/>
              <circle cx={n.x} cy={n.y} r={n.r * 2}   fill={NCOLOR[n.type]} opacity="0.10"/>
              <circle cx={n.x} cy={n.y} r={n.r}       fill={NCOLOR[n.type]} opacity="0.9" filter="url(#glow)"/>
            </g>
          ))}
        </svg>

        {/* Hero text */}
        <div style={{ maxWidth:1180, margin:'0 auto', padding:'80px 24px 100px', position:'relative', zIndex:10, width:'100%', textAlign:'center' }}>

          {/* Badge */}
          <div style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'5px 16px', borderRadius:100, background:'rgba(56,189,248,0.08)', border:'1px solid rgba(56,189,248,0.2)', marginBottom:32, animation:'fadeup .6s ease both' }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:'#38bdf8', display:'inline-block', animation:'pulse 2s ease-in-out infinite' }} />
            <span style={{ fontSize:12, color:'#7dd3fc', fontWeight:600, letterSpacing:0.5 }}>{content.hero_badge}</span>
          </div>

          {/* H1 */}
          <div style={{ animation:'fadeup .6s .1s ease both' }}>
            <h1 className="hero-h1" style={{ fontSize:'clamp(3.2rem,7.5vw,5.8rem)', fontWeight:900, lineHeight:1.05, letterSpacing:-3, color:'#f8fafc', marginBottom:8 }}>
              {content.hero_title_1}
            </h1>
            <h1 className="hero-h1 grad-text" style={{ fontSize:'clamp(3.2rem,7.5vw,5.8rem)', fontWeight:900, lineHeight:1.05, letterSpacing:-3, marginBottom:36 }}>
              {content.hero_title_2}
            </h1>
          </div>

          {/* Subheadline */}
          <p style={{ fontSize:'clamp(1rem,2.2vw,1.2rem)', color:'#94a3b8', maxWidth:620, margin:'0 auto 48px', lineHeight:1.75, animation:'fadeup .6s .2s ease both' }}>
            {content.hero_sub}
          </p>

          {/* Buttons */}
          <div className="cta-row" style={{ display:'flex', gap:16, justifyContent:'center', flexWrap:'wrap', animation:'fadeup .6s .3s ease both' }}>
            <a href="/"
              style={{ padding:'15px 36px', borderRadius:13, background:'linear-gradient(135deg,#0ea5e9,#8b5cf6)', color:'#fff', fontSize:16, fontWeight:800, textDecoration:'none', boxShadow:'0 8px 32px rgba(14,165,233,0.4)', letterSpacing:-0.3 }}
              className="btn-primary"
            >
              {content.cta_primary}
            </a>
            <a href="https://github.com" target="_blank" rel="noopener"
              style={{ padding:'15px 36px', borderRadius:13, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', color:'#cbd5e1', fontSize:16, fontWeight:600, textDecoration:'none' }}
              className="btn-ghost"
            >
              {content.cta_secondary}
            </a>
          </div>

          {/* Scroll arrow */}
          <div style={{ marginTop:80, display:'flex', flexDirection:'column', alignItems:'center', gap:8, animation:'float 2.5s ease-in-out infinite', opacity:.35 }}>
            <svg width="22" height="36" viewBox="0 0 22 36" fill="none">
              <rect x="1" y="1" width="20" height="34" rx="10" stroke="#94a3b8" strokeWidth="1.5"/>
              <rect x="9.5" y="7" width="3" height="7" rx="1.5" fill="#94a3b8"/>
            </svg>
            <span style={{ fontSize:10, color:'#475569', letterSpacing:3, textTransform:'uppercase' }}>scroll</span>
          </div>
        </div>
      </section>

      {/* ══════════ FEATURES ═══════════════════════════════════════════════ */}
      <section
        id="features"
        ref={el => { sectionsRef.current.features = el }}
        className={`section-reveal ${visible.features ? 'in' : ''}`}
        style={{ background:'#04091a', padding:'110px 24px', position:'relative', overflow:'hidden' }}
      >
        <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', width:900, height:500, background:'radial-gradient(ellipse,rgba(139,92,246,0.07) 0%,transparent 70%)', pointerEvents:'none' }} />

        <div style={{ maxWidth:1180, margin:'0 auto', position:'relative', zIndex:1 }}>
          <div style={{ textAlign:'center', marginBottom:72 }}>
            <span style={{ fontSize:11, letterSpacing:4, textTransform:'uppercase', color:'#8b5cf6', fontWeight:700 }}>Features</span>
            <h2 style={{ fontSize:'clamp(1.8rem,4vw,2.8rem)', fontWeight:900, color:'#f1f5f9', letterSpacing:-1.5, marginTop:10, lineHeight:1.2 }}>
              {content.feat_heading.split('to')[0]}to<br/>
              <span className="grad-text">{content.feat_heading.split('to')[1]}</span>
            </h2>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(255px,1fr))', gap:20 }}>
            {[
              { icon:'🕸️', title:content.f1_title, body:content.f1_body, c:'#0ea5e9', gA:'rgba(14,165,233,0.12)', gB:'rgba(14,165,233,0.02)' },
              { icon:'🌐', title:content.f2_title, body:content.f2_body, c:'#8b5cf6', gA:'rgba(139,92,246,0.12)', gB:'rgba(139,92,246,0.02)' },
              { icon:'📄', title:content.f3_title, body:content.f3_body, c:'#f59e0b', gA:'rgba(245,158,11,0.12)', gB:'rgba(245,158,11,0.02)' },
              { icon:'🔬', title:content.f4_title, body:content.f4_body, c:'#10b981', gA:'rgba(16,185,129,0.12)', gB:'rgba(16,185,129,0.02)' },
            ].map((f, i) => (
              <div
                key={i}
                className="card-hover"
                style={{ background:`linear-gradient(145deg,${f.gA},${f.gB})`, border:`1px solid ${f.c}20`, borderRadius:22, padding:'32px 26px', position:'relative', overflow:'hidden' }}
                onMouseEnter={e => e.currentTarget.style.boxShadow=`0 24px 60px ${f.c}20`}
                onMouseLeave={e => e.currentTarget.style.boxShadow='none'}
              >
                {/* Top accent line */}
                <div style={{ position:'absolute', top:0, left:24, right:24, height:1, background:`linear-gradient(90deg,transparent,${f.c}60,transparent)` }} />
                <div style={{ fontSize:36, marginBottom:18 }}>{f.icon}</div>
                <h3 style={{ fontSize:17, fontWeight:800, color:'#f1f5f9', marginBottom:10, letterSpacing:-0.3 }}>{f.title}</h3>
                <p style={{ fontSize:14, color:'#64748b', lineHeight:1.75 }}>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ HOW IT WORKS ════════════════════════════════════════════ */}
      <section
        id="how"
        ref={el => { sectionsRef.current.how = el }}
        className={`section-reveal ${visible.how ? 'in' : ''}`}
        style={{ background:'#020617', padding:'110px 24px', position:'relative' }}
      >
        {/* Side decorations */}
        <div style={{ position:'absolute', left:-100, top:'30%', width:350, height:350, borderRadius:'50%', background:'radial-gradient(ellipse,rgba(14,165,233,0.06) 0%,transparent 70%)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', right:-80, bottom:'20%', width:300, height:300, borderRadius:'50%', background:'radial-gradient(ellipse,rgba(52,211,153,0.06) 0%,transparent 70%)', pointerEvents:'none' }} />

        <div style={{ maxWidth:760, margin:'0 auto', position:'relative', zIndex:1 }}>
          <div style={{ textAlign:'center', marginBottom:72 }}>
            <span style={{ fontSize:11, letterSpacing:4, textTransform:'uppercase', color:'#0ea5e9', fontWeight:700 }}>{content.how_label}</span>
            <h2 style={{ fontSize:'clamp(1.8rem,4vw,2.8rem)', fontWeight:900, color:'#f1f5f9', letterSpacing:-1.5, marginTop:10 }}>
              {content.how_title}
            </h2>
          </div>

          <div style={{ position:'relative' }}>
            {/* Vertical connector line */}
            <div style={{ position:'absolute', left:28, top:28, bottom:28, width:1, background:'linear-gradient(to bottom,rgba(14,165,233,0.3),rgba(139,92,246,0.3),rgba(52,211,153,0.3))', pointerEvents:'none' }} />

            {[
              { n:content.s1_n, title:content.s1_title, body:content.s1_body, c:'#0ea5e9', shadow:'rgba(14,165,233,0.3)' },
              { n:content.s2_n, title:content.s2_title, body:content.s2_body, c:'#8b5cf6', shadow:'rgba(139,92,246,0.3)' },
              { n:content.s3_n, title:content.s3_title, body:content.s3_body, c:'#10b981', shadow:'rgba(16,185,129,0.3)' },
            ].map((s, i) => (
              <div key={i} style={{ display:'flex', gap:28, alignItems:'flex-start', padding:'28px 0 28px 0', borderBottom: i < 2 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                <div style={{ flexShrink:0, width:56, height:56, borderRadius:16, background:`${s.c}14`, border:`1px solid ${s.c}35`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:900, color:s.c, letterSpacing:1.5, boxShadow:`0 0 20px ${s.shadow}` }}>
                  {s.n}
                </div>
                <div style={{ paddingTop:4 }}>
                  <h3 style={{ fontSize:19, fontWeight:800, color:'#f1f5f9', marginBottom:8, letterSpacing:-0.4 }}>{s.title}</h3>
                  <p style={{ fontSize:15, color:'#475569', lineHeight:1.75 }}>{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ STATS ═══════════════════════════════════════════════════ */}
      <section
        id="stats"
        ref={el => { sectionsRef.current.stats = el }}
        className={`section-reveal ${visible.stats ? 'in' : ''}`}
        style={{ background:'linear-gradient(135deg,#0d1635 0%,#16063b 50%,#0d1635 100%)', padding:'90px 24px', borderTop:'1px solid rgba(139,92,246,0.18)', borderBottom:'1px solid rgba(139,92,246,0.18)', position:'relative', overflow:'hidden' }}
      >
        <div style={{ position:'absolute', inset:0, backgroundImage:'linear-gradient(rgba(139,92,246,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(139,92,246,0.03) 1px,transparent 1px)', backgroundSize:'48px 48px', pointerEvents:'none' }} />

        <div style={{ maxWidth:900, margin:'0 auto', display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:48, textAlign:'center', position:'relative', zIndex:1 }}>
          {[
            { n:content.stat1_n, l:content.stat1_l, c:'#38bdf8' },
            { n:content.stat2_n, l:content.stat2_l, c:'#c084fc' },
            { n:content.stat3_n, l:content.stat3_l, c:'#34d399' },
          ].map((s, i) => (
            <div key={i}>
              <div style={{ fontSize:'clamp(2.8rem,6vw,4rem)', fontWeight:900, color:s.c, letterSpacing:-2, lineHeight:1, textShadow:`0 0 30px ${s.c}50` }}>{s.n}</div>
              <div style={{ fontSize:14, color:'#475569', marginTop:10, letterSpacing:0.5, textTransform:'uppercase', fontWeight:600 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ══════════ LANGUAGE SHOWCASE ═══════════════════════════════════════ */}
      <section
        id="langs"
        ref={el => { sectionsRef.current.langs = el }}
        className={`section-reveal ${visible.langs ? 'in' : ''}`}
        style={{ background:'#020617', padding:'90px 24px', textAlign:'center' }}
      >
        <span style={{ fontSize:11, letterSpacing:4, textTransform:'uppercase', color:'#34d399', fontWeight:700 }}>Multilingual</span>
        <h2 style={{ fontSize:'clamp(1.6rem,3.5vw,2.4rem)', fontWeight:900, color:'#f1f5f9', letterSpacing:-1, marginTop:10, marginBottom:10 }}>
          Pick a language — watch the magic
        </h2>
        <p style={{ fontSize:14, color:'#475569', marginBottom:48 }}>Translated live via Lingo.dev. Click any flag.</p>

        <div style={{ display:'flex', flexWrap:'wrap', gap:12, justifyContent:'center', maxWidth:700, margin:'0 auto' }}>
          {LANGS.map(l => (
            <button
              key={l.code}
              onClick={() => switchLocale(l.code)}
              style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 18px', borderRadius:12, background: l.code === locale ? 'rgba(56,189,248,0.12)' : 'rgba(255,255,255,0.04)', border: l.code === locale ? '1px solid rgba(56,189,248,0.35)' : '1px solid rgba(255,255,255,0.08)', color: l.code === locale ? '#38bdf8' : '#94a3b8', fontSize:14, cursor:'pointer', fontWeight: l.code === locale ? 700 : 400, transition:'all .2s' }}
              className="lang-btn"
            >
              <span style={{ fontSize:20 }}>{l.flag}</span>
              <span>{l.label}</span>
              {l.code === locale && loading && <span className="spin-sm" style={{ width:12, height:12, border:'2px solid #38bdf8', borderTopColor:'transparent', borderRadius:'50%', display:'inline-block' }} />}
            </button>
          ))}
        </div>
      </section>

      {/* ══════════ FOOTER ══════════════════════════════════════════════════ */}
      <footer style={{ background:'#020617', borderTop:'1px solid rgba(255,255,255,0.05)', padding:'56px 24px', textAlign:'center' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, marginBottom:12 }}>
          <div style={{ width:30, height:30, borderRadius:8, background:'linear-gradient(135deg,#0ea5e9,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15 }}>🐝</div>
          <span style={{ fontSize:17, fontWeight:800, color:'#fff', letterSpacing:-0.3 }}>PaperSwarm</span>
        </div>
        <p style={{ fontSize:13, color:'#1e3a5f', marginBottom:32 }}>{content.footer_tag}</p>

        {/* Flag quick-switcher */}
        <div style={{ display:'flex', justifyContent:'center', gap:20, marginBottom:40 }}>
          {LANGS.map(l => (
            <button
              key={l.code}
              onClick={() => switchLocale(l.code)}
              title={l.label}
              className="footer-flag"
              style={{ background:'none', border:'none', cursor:'pointer', fontSize:22, opacity: l.code === locale ? 1 : 0.3, transform: l.code === locale ? 'scale(1.25)' : 'scale(1)' }}
            >
              {l.flag}
            </button>
          ))}
        </div>

        <a href="/"
          style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'12px 28px', borderRadius:12, background:'linear-gradient(135deg,#0ea5e9,#8b5cf6)', color:'#fff', fontSize:14, fontWeight:700, textDecoration:'none', boxShadow:'0 4px 20px rgba(14,165,233,0.3)' }}
          className="btn-primary"
        >
          {content.nav_launch} →
        </a>
      </footer>
    </div>
  )
}
