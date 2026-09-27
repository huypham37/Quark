import { CatalogModelRuntime } from "./src/tui/catalog-model-runtime.ts"
import { buildModelPickerOptions } from "./src/tui/model-picker.ts"

const rt = await CatalogModelRuntime.create()
await rt.active.refresh()
console.log("active providers:", rt.active.listProviderIds())
const opts = buildModelPickerOptions(rt.active, rt.catalog)
console.log("total options:", opts.length)
console.log("claude matches:", opts.filter((o) => /claude/i.test(o.id + o.name)).map((o) => o.id).slice(0, 8))
