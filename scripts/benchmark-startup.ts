// Actual Node CLI -> Bun TUI -> first native frame, with identical offline fixtures.
// Usage: bun scripts/benchmark-startup.ts --baseline /path/to/baseline/packages/quark --out /tmp/quark-proof --runs 7
import { parseArgs } from "node:util"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { resolve, join } from "node:path"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"

const { values } = parseArgs({ options: {
  baseline: { type: "string" }, out: { type: "string" }, runs: { type: "string", default: "7" },
} })
if (!values.baseline) throw new Error("Pass --baseline pointing to the unmodified, built quark package")
const runs = Number(values.runs)
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer")
const root = fileURLToPath(new URL("../", import.meta.url))
const out = values.out ? resolve(values.out) : mkdtempSync(join(tmpdir(), "quark-startup-proof-"))
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(out, "fixture-"))
const home = join(fixture, "home")
const config = join(home, ".config", "quark")
const bin = join(fixture, "bin")
mkdirSync(join(config, "profile"), { recursive: true })
mkdirSync(bin)
// Only the public catalog is copied; no user config, credentials, or sessions.
const cache = join(homedir(), ".config", "quark", "models-catalog.json")
const catalog = JSON.parse(readFileSync(cache, "utf8"))
const selected = Object.values(catalog.catalog.openai.models).find((entry: any) => entry.limit.context) as any
if (!selected) throw new Error("Benchmark needs an OpenAI catalog model with a context limit")
copyFileSync(cache, join(config, "models-catalog.json"))
writeFileSync(join(config, "config.yaml"), `version: 3\ndefault_agent: coder\nmodels:\n  small: openai/${selected.id}\n`)
writeFileSync(join(config, "profile", "coder.yaml"), `name: Benchmark\nmodel:\n  id: openai/${selected.id}\ntools: []\nskills: []\n`)
const preload = join(fixture, "probe.ts")
const specifier = (name: string) => JSON.stringify(Bun.resolveSync(name, root))
writeFileSync(preload, `
import { writeFileSync, writeSync } from "node:fs";
import { CliRenderer } from ${specifier("@opentui/core")};
import { CatalogSnapshotStore } from ${specifier("@quark/runner/provider/catalog-snapshot")};
import { MacOSKeychainCredentialStore, ProtectedFileCredentialStore } from ${specifier("@quark/runner/provider/credential-store")};
// Keep credentials and network out of both measurements, without changing cache/JSX work.
MacOSKeychainCredentialStore.prototype.get = async () => null;
ProtectedFileCredentialStore.prototype.get = async () => null;
CatalogSnapshotStore.prototype.refresh = async function () { return this.snapshot; };
let tsxLoads = 0, cacheLoads = 0, firstFrame = null, cacheEvents = [];
// Solid's official loader calls Bun.file(path).text() once per TSX transform.
Bun.file = new Proxy(Bun.file, { apply(target, receiver, args) {
  if (typeof args[0] === "string" && args[0].endsWith(".tsx")) tsxLoads++;
  return Reflect.apply(target, receiver, args);
}});
const loadCache = CatalogSnapshotStore.prototype.loadCache;
CatalogSnapshotStore.prototype.loadCache = function (...args) {
  const start = performance.now();
  cacheLoads++;
  const snapshot = loadCache.apply(this, args);
  cacheEvents.push({ afterFirstFrame: firstFrame !== null, durationMs: performance.now() - start, models: snapshot ? Object.values(snapshot.catalog).reduce((n, p) => n + Object.keys(p.models).length, 0) : 0 });
  return snapshot;
};
const hasPrompt = node => node.constructor.name === "TextareaRenderable" || (node.getChildren?.() ?? []).some(hasPrompt);
const native = CliRenderer.prototype.renderNative;
CliRenderer.prototype.renderNative = function (...args) {
  const mounted = hasPrompt(this.root);
  const result = native.apply(this, args);
  if (mounted && firstFrame === null) {
    firstFrame = { firstNativeFrameMs: Date.now() - Number(process.env.QUARK_BENCHMARK_STARTED), tuiFirstNativeFrameMs: performance.now(), tsxLoadsAtFirstFrame: tsxLoads, cacheLoadsAtFirstFrame: cacheLoads };
    setImmediate(() => {
      writeFileSync(process.env.QUARK_BENCHMARK_LOG, JSON.stringify({ ...firstFrame, tsxLoadsTotal: tsxLoads, cacheLoadsTotal: cacheLoads, cacheEvents }));
      this.destroy();
      writeSync(1, "STARTUP_BENCHMARK_DONE\\n");
      process.exit(0);
    });
  }
  return result;
};
`)
const realBun = process.execPath
writeFileSync(join(bin, "bun"), `#!/bin/sh\nexec ${JSON.stringify(realBun)} --preload ${JSON.stringify(preload)} "$@"\n`, { mode: 0o755 })
const packages = { before: resolve(values.baseline), after: join(root, "packages", "quark") }
const results: Record<string, any[]> = { before: [], after: [] }
for (let iteration = 0; iteration <= runs; iteration++) {
  // Alternate order to reduce filesystem-cache/order bias. Iteration zero warms both.
  for (const mode of iteration % 2 ? ["after", "before"] : ["before", "after"]) {
    const log = join(out, `${mode}-${iteration}.json`)
    const env = { ...process.env, HOME: home, QUARK_CONFIG_DIR: config, QUARK_DIR: packages[mode as keyof typeof packages],
      OPENAI_API_KEY: "benchmark-only-not-a-real-key", PATH: `${bin}:${process.env.PATH}`,
      QUARK_BENCHMARK_LOG: log, QUARK_BENCHMARK_STARTED: String(Date.now()) }
    delete env.QUARK_THEME
    delete env.QUARK_API_PORT
    delete env.QUARK_SESSION_ID
    const command = ["show", "--cwd", fixture, "--host", "opentui", "--cols", "120", "--rows", "40",
      "--wait-for", "STARTUP_BENCHMARK_DONE", "--deadline-ms", "10000", "--", "node", join(packages[mode as keyof typeof packages], "dist", "cli.js")]
    const child = spawnSync("termctrl", command, { env, encoding: "utf8" })
    if (child.status !== 0) throw new Error(`${mode} run ${iteration} failed (${child.status}): ${child.stderr}\n${child.stdout}`)
    const result = JSON.parse(readFileSync(log, "utf8"))
    if (result.cacheLoadsTotal !== 1 || !result.cacheEvents[0]?.models) throw new Error("Disk catalog was not restored")
    if (mode === "after" && (result.tsxLoadsTotal !== 0 || result.cacheLoadsAtFirstFrame !== 0 || !result.cacheEvents[0].afterFirstFrame)) {
      throw new Error(`Fixed-build startup invariant failed: ${JSON.stringify(result)}`)
    }
    if (mode === "before" && (result.tsxLoadsAtFirstFrame < 1 || result.cacheLoadsAtFirstFrame !== 1)) throw new Error("Baseline did not exercise original startup work")
    console.log(JSON.stringify({ mode, iteration, exit: child.status, ...result }))
    if (iteration > 0) results[mode]!.push(result)
  }
}
const median = (items: number[]) => {
  const sorted = items.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
const beforeMs = median(results.before!.map((r) => r.firstNativeFrameMs))
const afterMs = median(results.after!.map((r) => r.firstNativeFrameMs))
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")
const summary = { runs, theme: "automatic (unchanged)", conditions: "same isolated profile/catalog, offline, no credential access, Node CLI launch, first native frame containing textarea",
  catalogBytes: readFileSync(cache).byteLength, catalogSha256: hash(cache),
  baselineCliSha256: hash(join(packages.before, "dist", "cli.js")), fixedCliSha256: hash(join(packages.after, "dist", "cli.js")), fixedTuiSha256: hash(join(packages.after, "dist", "tui.js")),
  beforeMedianMs: beforeMs, afterMedianMs: afterMs, reductionPercent: Math.round((1 - afterMs / beforeMs) * 100), results }
writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n")
console.log(`Proof: ${join(out, "summary.json")}\nMedian: ${beforeMs} ms -> ${afterMs} ms (${summary.reductionPercent}% reduction)`)
