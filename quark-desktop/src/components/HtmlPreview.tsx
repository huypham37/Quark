import { useState, useEffect } from "react"

interface HtmlPreviewProps {
  filePath: string | null
  backendUrl: string
  refreshKey: number
}

export function HtmlPreview({ filePath, backendUrl, refreshKey }: HtmlPreviewProps) {
  const [htmlContent, setHtmlContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!filePath) {
      setHtmlContent(null)
      setError(null)
      return
    }

    // Only preview .html files
    if (!filePath.endsWith(".html") && !filePath.endsWith(".htm")) {
      setHtmlContent(null)
      setError(null)
      return
    }

    let cancelled = false

    async function load() {
      try {
        const res = await fetch(`${backendUrl}/api/workspace/file?path=${encodeURIComponent(filePath!)}`)
        if (!res.ok) throw new Error(`Failed to load: ${res.status}`)
        const { content } = await res.json()
        if (!cancelled) {
          setHtmlContent(content)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e))
          setHtmlContent(null)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [filePath, refreshKey, backendUrl])

  if (!filePath) {
    return (
      <div style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-secondary, #8888a0)",
        fontSize: "14px",
        userSelect: "none",
      }}>
        Select an HTML file to preview
      </div>
    )
  }

  if (!filePath.endsWith(".html") && !filePath.endsWith(".htm")) {
    return (
      <div style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-secondary, #8888a0)",
        fontSize: "14px",
        userSelect: "none",
      }}>
        Preview not available for this file type
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#e55",
        fontSize: "14px",
      }}>
        Failed to load preview: {error}
      </div>
    )
  }

  return (
    <iframe
      srcDoc={htmlContent || ""}
      sandbox="allow-scripts"
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        background: "#fff",
      }}
      title="HTML Preview"
    />
  )
}
