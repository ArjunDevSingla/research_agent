/**
 * hooks/useGraph.js
 * Fetches KnowledgeGraph from gateway and converts to Cytoscape elements.
 */
import { useState, useEffect, useCallback } from 'react'

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8000'

// Node colors by type
const NODE_STYLE = {
  seed:          { bg: '#1e3a5f', color: '#ffffff', shape: 'round-rectangle' },
  similar_paper: { bg: '#2563eb', color: '#ffffff', shape: 'ellipse' },
  future_gap:    { bg: '#7c3aed', color: '#ffffff', shape: 'diamond' },
}

// Edge colors by type
const EDGE_COLOR = {
  similar_to:   '#93c5fd',
  future_gap:   '#c4b5fd',
  solves:       '#86efac',
  working_on:   '#fde68a',
  mentions_gap: '#e2e8f0',
}

function graphToCytoscape(graph) {
  if (!graph) return []

  const elements = []

  // Nodes
  for (const node of graph.nodes || []) {
    const style = NODE_STYLE[node.type] || NODE_STYLE.similar_paper
    elements.push({
      data: {
        id:           node.id,
        label:        truncate(node.label, 40),
        full_label:   node.label,
        type:         node.type,
        bg:           style.bg,
        color:        style.color,
        nodeData:     node.data,
      }
    })
  }

  // Edges
  for (const edge of graph.edges || []) {
    elements.push({
      data: {
        id:        `${edge.source}-${edge.target}-${edge.edge_type}`,
        source:    edge.source,
        target:    edge.target,
        weight:    edge.weight,
        label:     edge.label || '',
        edge_type: edge.edge_type,
        color:     EDGE_COLOR[edge.edge_type] || '#cbd5e1',
      }
    })
  }

  return elements
}

function truncate(str, len) {
  if (!str) return ''
  return str.length > len ? str.slice(0, len) + '…' : str
}

export function useGraph(jobId) {
  const [graph,    setGraph]    = useState(null)
  const [elements, setElements] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  const fetchGraph = useCallback(async () => {
    if (!jobId) return
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(`${GATEWAY}/graph/${jobId}`)
      if (!resp.ok) {
        if (resp.status === 404) {
          setError('Graph not ready yet')
          return
        }
        throw new Error(`HTTP ${resp.status}`)
      }
      const data = await resp.json()
      setGraph(data)
      setElements(graphToCytoscape(data))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [jobId])

  // Auto-fetch when jobId changes
  useEffect(() => { fetchGraph() }, [fetchGraph])

  return { graph, elements, loading, error, refetch: fetchGraph }
}
