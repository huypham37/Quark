import type { MiddleView } from "../state"

interface AppHeaderProps {
  activeView: MiddleView
  hasReview: boolean
  onViewChange: (view: MiddleView) => void
  onToggleLeftPanel?: () => void
  onToggleRightPanel?: () => void
  showLeftToggle?: boolean
}

export function AppHeader({
  activeView,
  onViewChange,
  onToggleLeftPanel,
  onToggleRightPanel,
  showLeftToggle = false,
}: AppHeaderProps) {
  return (
    <header className="app-header" aria-label="Page header" data-tauri-drag-region>
      {showLeftToggle && (
        <div className="header-sidebar-actions">
          <button
            aria-label="Show sidebar"
            title="Show sidebar"
            onClick={onToggleLeftPanel}
          >
            <svg className="codex-icon"><use href="#icon-panel-left" /></svg>
          </button>
        </div>
      )}

      <div className="segment" role="tablist" aria-label="Editor mode">
        <button
          className={`segment-btn ${activeView === "visual" ? "active" : ""}`}
          role="tab"
          aria-selected={activeView === "visual"}
          onClick={() => onViewChange("visual")}
        >
          Visual
        </button>
        <button
          className={`segment-btn ${activeView === "source" ? "active" : ""}`}
          role="tab"
          aria-selected={activeView === "source"}
          onClick={() => onViewChange("source")}
        >
          Source
        </button>
      </div>
      <div className="header-actions" aria-label="Header actions">
        <button aria-label="New artifact" title="New artifact">
          <svg className="codex-icon"><use href="#icon-file-plus" /></svg>
        </button>
        <button aria-label="Open web" title="Open web">
          <svg className="codex-icon"><use href="#icon-globe" /></svg>
        </button>
        <button aria-label="Menu" title="Menu">
          <svg className="codex-icon"><use href="#icon-list" /></svg>
        </button>
        <button
          aria-label="Toggle panel"
          title="Toggle panel"
          onClick={onToggleRightPanel}
        >
          <svg className="codex-icon"><use href="#icon-panel-right" /></svg>
        </button>
      </div>
    </header>
  )
}
