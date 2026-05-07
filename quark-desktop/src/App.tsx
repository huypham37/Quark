import { useState, useCallback, useEffect, useReducer, useMemo } from "react"
import { LeftPane } from "./components/LeftPane"
import { RightPane } from "./components/RightPane"
import { MiddlePane, type MiddleView } from "./components/MiddlePane"
import { AppHeader } from "./components/AppHeader"
import { IconSprite } from "./components/IconSprite"
import { useDesktopEvents } from "./useDesktopEvents"
import { getBackendUrl } from "./backend"
import { desktopReducer, initialDesktopState } from "./state"
import { buildContext } from "./context"
import "./App.css"

export function App() {
  const [leftPanelVisible, setLeftPanelVisible] = useState(true)
  const [rightPanelVisible, setRightPanelVisible] = useState(true)
  const [backendUrl, setBackendUrl] = useState<string | null>(null)

  const [desktop, desktopDispatch] = useReducer(desktopReducer, initialDesktopState)

  useDesktopEvents(desktopDispatch)

  useEffect(() => {
    getBackendUrl().then(setBackendUrl).catch(console.error)
  }, [])

  const handleSelectFile = useCallback((path: string) => {
    desktopDispatch({ type: "SELECT_FILE", path })
  }, [])

  const handleViewChange = useCallback((view: MiddleView) => {
    desktopDispatch({ type: "SET_VIEW", view })
  }, [])

  // Permission handlers
  const handleApprove = useCallback(async () => {
    if (!desktop.activeReview) return
    await fetch(`${backendUrl}/api/permission`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: desktop.activeReview.permissionRequestId, action: "once" }),
    })
  }, [backendUrl, desktop.activeReview])

  const handleAlways = useCallback(async () => {
    if (!desktop.activeReview) return
    await fetch(`${backendUrl}/api/permission`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: desktop.activeReview.permissionRequestId, action: "always" }),
    })
  }, [backendUrl, desktop.activeReview])

  const handleReject = useCallback(async () => {
    if (!desktop.activeReview) return
    await fetch(`${backendUrl}/api/permission`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: desktop.activeReview.permissionRequestId, action: "reject" }),
    })
  }, [backendUrl, desktop.activeReview])

  const handleCorrect = useCallback(async (correction: string) => {
    if (!desktop.activeReview) return
    await fetch(`${backendUrl}/api/permission`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: desktop.activeReview.permissionRequestId, action: "reject", correction }),
    })
  }, [backendUrl, desktop.activeReview])

  const context = useMemo(() => buildContext(desktop), [desktop])

  if (!backendUrl) {
    return (
      <div className="empty-state" style={{ height: "100vh", background: "var(--bg)", fontSize: "16px" }}>
        Connecting to Quark backend...
      </div>
    )
  }

  return (
    <>
      <IconSprite />
      <main className={`app ${!leftPanelVisible ? "no-left" : ""} ${!rightPanelVisible ? "no-right" : ""}`}>
        {leftPanelVisible && (
          <aside className="pane left-pane">
            <LeftPane
              backendUrl={backendUrl}
              onSelectFile={handleSelectFile}
              onTogglePanel={() => setLeftPanelVisible(false)}
            />
          </aside>
        )}

        {/* App Header — spans all columns */}
        <AppHeader
          activeView={desktop.activeView}
          hasReview={desktop.activeReview !== null}
          onViewChange={handleViewChange}
          onToggleLeftPanel={() => setLeftPanelVisible(v => !v)}
          onToggleRightPanel={() => setRightPanelVisible(v => !v)}
          showLeftToggle={!leftPanelVisible}
        />

        {/* Middle Pane — Canvas */}
        <section className="pane canvas-pane">
          <MiddlePane
            activeView={desktop.activeView}
            activeFile={desktop.activeFile}
            activeReview={desktop.activeReview}
            previewRefreshKey={desktop.previewRefreshKey}
            backendUrl={backendUrl}
            onViewChange={handleViewChange}
            onDraftChange={(content) => desktopDispatch({ type: "SET_DRAFT", content })}
            onApprove={handleApprove}
            onAlways={handleAlways}
            onReject={handleReject}
            onCorrect={handleCorrect}
          />
        </section>

        {/* Right Pane — Agent Intelligence */}
        {rightPanelVisible && (
          <aside className="pane right-pane">
            <RightPane backendUrl={backendUrl} context={context} />
          </aside>
        )}
      </main>
    </>
  )
}
