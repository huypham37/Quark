// Preload for the Bun TUI: delegate to @opentui/solid's supported preload
// export. Its JSX/Babel transform then resolves @babel/core and friends from
// @opentui/solid's own declared dependencies, so no Babel package has to be
// (undeclared) hoisted to the quark package under strict installs.
import "@opentui/solid/preload"
