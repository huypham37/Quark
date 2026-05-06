// SVG icon sprite matching the prototype design.
// Usage: <svg className="codex-icon"><use href="#icon-folder" /></svg>
export function IconSprite() {
  return (
    <svg className="icon-sprite" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <symbol id="icon-panel-left" viewBox="0 0 24 24">
        <rect x="5" y="5" width="14" height="14" rx="2.5" />
        <path d="M9.5 5v14" />
      </symbol>
      <symbol id="icon-panel-right" viewBox="0 0 24 24">
        <rect x="5" y="5" width="14" height="14" rx="2.5" />
        <path d="M14.5 5v14" />
      </symbol>
      <symbol id="icon-arrow-left" viewBox="0 0 24 24">
        <path d="M15 6.5 9.5 12 15 17.5" />
      </symbol>
      <symbol id="icon-arrow-right" viewBox="0 0 24 24">
        <path d="m9 6.5 5.5 5.5L9 17.5" />
      </symbol>
      <symbol id="icon-folder" viewBox="0 0 24 24">
        <path d="M4.5 8.5h5l1.8 2h8.2v6.8a2.2 2.2 0 0 1-2.2 2.2H6.7a2.2 2.2 0 0 1-2.2-2.2Z" />
        <path d="M4.5 8.5V7a2 2 0 0 1 2-2H10l1.8 2h5.7a2 2 0 0 1 2 2v1.5" />
      </symbol>
      <symbol id="icon-list" viewBox="0 0 24 24">
        <path d="M8.5 7h10" />
        <path d="M8.5 12h10" />
        <path d="M8.5 17h10" />
        <path d="M5.5 7h.1" />
        <path d="M5.5 12h.1" />
        <path d="M5.5 17h.1" />
      </symbol>
      <symbol id="icon-table" viewBox="0 0 24 24">
        <rect x="5" y="5" width="14" height="14" rx="2" />
        <path d="M5 10h14" />
        <path d="M10 5v14" />
      </symbol>
      <symbol id="icon-settings" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M18.2 13.4c.1-.45.1-.95 0-1.4l1.8-1.4-1.8-3.1-2.2.9a6.4 6.4 0 0 0-1.2-.7L14.5 5h-5l-.3 2.7c-.45.18-.85.42-1.2.7l-2.2-.9L4 10.6 5.8 12c-.1.45-.1.95 0 1.4L4 14.8l1.8 3.1 2.2-.9c.35.28.75.52 1.2.7l.3 2.7h5l.3-2.7c.45-.18.85-.42 1.2-.7l2.2.9 1.8-3.1Z" />
      </symbol>
      <symbol id="icon-more-h" viewBox="0 0 24 24">
        <path d="M8 12h.1" />
        <path d="M12 12h.1" />
        <path d="M16 12h.1" />
      </symbol>
      <symbol id="icon-more-v" viewBox="0 0 24 24">
        <path d="M12 8h.1" />
        <path d="M12 12h.1" />
        <path d="M12 16h.1" />
      </symbol>
      <symbol id="icon-file-plus" viewBox="0 0 24 24">
        <rect x="5.5" y="4" width="13" height="16" rx="2.5" />
        <path d="M9 8h6" />
        <path d="M12 5.5v5" />
        <path d="M9 16h6" />
      </symbol>
      <symbol id="icon-globe" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12h17" />
        <path d="M12 3.5c2.35 2.28 3.4 5.1 3.4 8.5s-1.05 6.22-3.4 8.5" />
        <path d="M12 3.5C9.65 5.78 8.6 8.6 8.6 12s1.05 6.22 3.4 8.5" />
      </symbol>
      <symbol id="icon-terminal" viewBox="0 0 24 24">
        <rect x="5" y="5" width="14" height="14" rx="2.5" />
        <path d="m9 10 2.2 2L9 14" />
        <path d="M13.5 14h3" />
      </symbol>
      <symbol id="icon-send" viewBox="0 0 24 24">
        <path d="m5 12 14-7-7 14-2-5Z" />
        <path d="m10 14 9-9" />
      </symbol>
      <symbol id="icon-copy" viewBox="0 0 24 24">
        <rect x="8" y="8" width="11" height="11" rx="2" />
        <path d="M5 15.5H4a1.5 1.5 0 0 1-1.5-1.5V5A2.5 2.5 0 0 1 5 2.5h9a1.5 1.5 0 0 1 1.5 1.5v1" />
      </symbol>
      <symbol id="icon-pencil" viewBox="0 0 24 24">
        <path d="m5 17.5-.5 2 2-.5L18.8 6.7a2 2 0 0 0-2.8-2.8Z" />
        <path d="m15 5 4 4" />
      </symbol>
      <symbol id="icon-anchor" viewBox="0 0 24 24">
        <circle cx="12" cy="5.5" r="2" />
        <path d="M12 7.5V19" />
        <path d="M8 11h8" />
        <path d="M5.5 14.5C6.5 18 8.6 19.5 12 19.5s5.5-1.5 6.5-5" />
      </symbol>
      <symbol id="icon-chevron-right" viewBox="0 0 24 24">
        <path d="m10 7 5 5-5 5" />
      </symbol>
      <symbol id="icon-chevron-down" viewBox="0 0 24 24">
        <path d="m7 10 5 5 5-5" />
      </symbol>
      <symbol id="icon-thumbs-up" viewBox="0 0 24 24">
        <path d="M7 10v10" />
        <path d="M10 10 12.5 4c.5-1.2 2.5-.8 2.5.6V9h3.5c1.1 0 1.9 1 1.6 2.1l-1.4 6.5A2 2 0 0 1 16.8 19H10a3 3 0 0 1-3-3v-3a3 3 0 0 1 3-3Z" />
      </symbol>
      <symbol id="icon-thumbs-down" viewBox="0 0 24 24">
        <path d="M7 14V4" />
        <path d="M10 14 12.5 20c.5 1.2 2.5.8 2.5-.6V15h3.5c1.1 0 1.9-1 1.6-2.1l-1.4-6.5A2 2 0 0 0 16.8 5H10a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3Z" />
      </symbol>
      <symbol id="icon-expand" viewBox="0 0 24 24">
        <path d="M8 4H4v4" />
        <path d="M4 4l6 6" />
        <path d="M16 20h4v-4" />
        <path d="m14 14 6 6" />
      </symbol>
      <symbol id="icon-plus" viewBox="0 0 24 24">
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </symbol>
      <symbol id="icon-arrow-up" viewBox="0 0 24 24">
        <path d="M12 19V5" />
        <path d="m6.5 10.5 5.5-5.5 5.5 5.5" />
      </symbol>
    </svg>
  )
}
