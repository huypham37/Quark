import { $ } from "bun"

let fileCache: string[] | null = null
let cacheDir: string | null = null

export async function getFiles(cwd?: string): Promise<string[]> {
  const dir = cwd ?? process.cwd()
  if (fileCache && cacheDir === dir) return fileCache

  try {
    const result = await $`git ls-files -z -co --exclude-standard`.cwd(dir).text()
    const files = result.split("\0").filter((f) => f.length > 0)
    const dirSet = new Set<string>()
    for (const f of files) {
      const parts = f.split("/")
      for (let i = 1; i < parts.length; i++) {
        dirSet.add(parts.slice(0, i).join("/") + "/")
      }
    }

    fileCache = [...files, ...dirSet].sort()
    cacheDir = dir
    return fileCache
  } catch {
    return getFilesFallback(dir)
  }
}

async function getFilesFallback(dir: string): Promise<string[]> {
  const skipDirs = new Set([
    "node_modules", ".git", ".next", "dist", "build",
    ".cache", ".turbo", "coverage", "__pycache__",
  ])

  const files: string[] = []
  const dirSet = new Set<string>()
  const glob = new Bun.Glob("**/*")

  let count = 0
  for await (const p of glob.scan({ cwd: dir, onlyFiles: true })) {
    const firstSegment = p.split("/")[0]
    if (firstSegment && skipDirs.has(firstSegment)) continue

    files.push(p)
    const parts = p.split("/")
    for (let i = 1; i < parts.length; i++) {
      dirSet.add(parts.slice(0, i).join("/") + "/")
    }
    count++
    if (count >= 5000) break
  }

  fileCache = [...files, ...dirSet].sort()
  cacheDir = dir
  return fileCache
}

export function clearFileCache(): void {
  fileCache = null
  cacheDir = null
}

export function fuzzyFilter(files: string[], query: string, limit = 15): string[] {
  if (!query) return files.slice(0, limit)

  const lowerQuery = query.toLowerCase()
  const scored: { file: string; score: number }[] = []

  for (const file of files) {
    const lowerFile = file.toLowerCase()
    let qi = 0
    let score = 0
    let lastMatchIdx = -1

    for (let fi = 0; fi < lowerFile.length && qi < lowerQuery.length; fi++) {
      if (lowerFile[fi] === lowerQuery[qi]) {
        if (fi === lastMatchIdx + 1) score += 2
        if (fi === 0 || lowerFile[fi - 1] === "/" || lowerFile[fi - 1] === ".") score += 3
        score += 1
        lastMatchIdx = fi
        qi++
      }
    }

    if (qi === lowerQuery.length) {
      score -= file.length * 0.01
      scored.push({ file, score })
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.file)
}
