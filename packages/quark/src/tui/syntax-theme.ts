// Re-export the live syntax style from the unified theme.
//
// Historically this file owned the hard-coded markdown/code syntax palette.
// It now delegates to `./theme`, which keeps a single SyntaxStyle instance
// in sync with the active theme (dark/light). Importers continue to use
// `import { syntaxStyle } from "../syntax-theme"` unchanged — the export
// is an ES module live binding that picks up theme swaps at startup.

export { syntaxStyle } from "./theme"
