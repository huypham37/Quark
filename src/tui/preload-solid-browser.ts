// Preload script that forces solid-js to resolve to its browser build
// instead of the server build (which is what Bun picks via the "node" condition).
//
// Unlike @opentui/solid/preload, this does NOT transform .tsx files through
// Babel, so it's safe to use alongside React test files.

import { plugin } from "bun"

plugin({
  name: "solid-browser-build",
  setup(build) {
    // Intercept solid-js server.js → solid.js
    build.onLoad(
      { filter: /\/node_modules\/solid-js\/dist\/server\.js$/ },
      async (args) => {
        const path = args.path.replace("server.js", "solid.js")
        const code = await Bun.file(path).text()
        return { contents: code, loader: "js" }
      },
    )
    // Intercept solid-js/store server.js → store.js
    build.onLoad(
      { filter: /\/node_modules\/solid-js\/store\/dist\/server\.js$/ },
      async (args) => {
        const path = args.path.replace("server.js", "store.js")
        const code = await Bun.file(path).text()
        return { contents: code, loader: "js" }
      },
    )
  },
})
