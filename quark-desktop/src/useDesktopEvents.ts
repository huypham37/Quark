import { useEffect, useRef } from "react"
import { getBackendUrl } from "./backend"
import type { DesktopAction, ActiveReview } from "./state"

export function useDesktopEvents(dispatch: (action: DesktopAction) => void) {
  const wsRef = useRef<WebSocket | null>(null)
  const reviewRef = useRef<ActiveReview | null>(null)

  useEffect(() => {
    let cancelled = false

    async function connect() {
      const url = await getBackendUrl()
      if (cancelled) return
      const wsUrl = url.replace(/^http/, "ws") + "/ws"
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          switch (msg.event) {
            case "tool-input": {
              const d = msg.data
              if ((d.tool === "edit" || d.tool === "write") && d.metadata?.diff) {
                const review: ActiveReview = {
                  messageId: d.messageId,
                  callId: d.callId,
                  tool: d.tool,
                  filePath: d.metadata.filePath || d.args?.filePath || "unknown",
                  diff: d.metadata.diff,
                  input: d.args || {},
                  permissionRequestId: "", // filled by permission-request event
                }
                reviewRef.current = review
                dispatch({ type: "SHOW_DIFF", review })
              }
              break
            }
            case "permission-request": {
              if (reviewRef.current) {
                reviewRef.current = { ...reviewRef.current, permissionRequestId: msg.data.requestId }
                dispatch({ type: "SHOW_DIFF", review: reviewRef.current })
              }
              break
            }
            case "tool-end": {
              const d = msg.data
              if (reviewRef.current && d.callId === reviewRef.current.callId) {
                reviewRef.current = null
                dispatch({ type: "CLEAR_REVIEW" })
                dispatch({ type: "REFRESH_PREVIEW" })
              }
              break
            }
          }
        } catch {}
      }

      ws.onclose = () => {
        if (!cancelled) setTimeout(connect, 2000)
      }
    }

    connect()
    return () => {
      cancelled = true
      wsRef.current?.close()
    }
  }, [dispatch])
}
