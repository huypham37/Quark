// FileList — utility for listing project files for @ mention autocomplete
//
// Uses `git ls-files` for speed and .gitignore respect.
// Falls back to a shallow directory walk if not in a git repo.
// Caches results and provides fuzzy filtering.

import { $ } from "bun"

let fileCache: string[] | null = null
let cacheDir: string | null = null

/** Get all tracked files using git ls-files, fallback to directory walk */
export async function getFiles(cwd?: string): Promise<string[]> {
  const dir = cwd ?? process.cwd()

  // Return cache if same directory
  if (fileCache && cacheDir === dir) return fileCache

  try {
    const result = await $`git ls-files -z`.cwd(dir).text()
    fileCache = result
      .split("\0")
      .filter((f) => f.length > 0)
      .sort()
    cacheDir = dir
    return fileCache
  } catch {
    // Not a git repo or git not available — fallback
    return getFilesFallback(dir)
  }
}

/** Fallback: walk directory up to 2 levels deep, skip common noise */
async function getFilesFallback(dir: string): Promise<string[]> {
  const skipDirs = new Set([
    "node_modules", ".git", ".next", "dist", "build",
    ".cache", ".turbo", "coverage", "__pycache__",
  ])

  const files: string[] = []
  const glob = new Bun.Glob("**/*")

  let count = 0
  for await (const path of glob.scan({ cwd: dir, onlyFiles: true })) {
    // Skip noise directories
    const firstSegment = path.split("/")[0]
    if (firstSegment && skipDirs.has(firstSegment)) continue

    files.push(path)
    count++
    if (count >= 5000) break // safety limit
  }

  fileCache = files.sort()
  cacheDir = dir
  return fileCache
}

/** Clear the file cache (e.g. after file operations) */
export function clearFileCache(): void {
  fileCache = null
  cacheDir = null
}

/** Fuzzy filter files by query — matches if all query chars appear in order */
export function fuzzyFilter(files: string[], query: string, limit = 15): string[] {
  if (!query) return files.slice(0, limit)

  const lowerQuery = query.toLowerCase()
  const scored: { file: string; score: number }[] = []

  for (const file of files) {
    const lowerFile = file.toLowerCase()

    // Check if all query chars appear in order
    let qi = 0
    let score = 0
    let lastMatchIdx = -1

    for (let fi = 0; fi < lowerFile.length && qi < lowerQuery.length; fi++) {
      if (lowerFile[fi] === lowerQuery[qi]) {
        // Bonus for consecutive matches
        if (fi === lastMatchIdx + 1) score += 2
        // Bonus for matching at segment boundaries (after / or .)
        if (fi === 0 || lowerFile[fi - 1] === "/" || lowerFile[fi - 1] === ".") score += 3
        score += 1
        lastMatchIdx = fi
        qi++
      }
    }

    if (qi === lowerQuery.length) {
      // Penalize long paths slightly
      score -= file.length * 0.01
      scored.push({ file, score })
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.file)
}
