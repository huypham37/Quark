import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { $ } from "bun"
import { getFiles, clearFileCache, fuzzyFilter } from "../../src/shared/filelist"

describe("filelist", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = `/tmp/quark-filelist-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(`${tmpDir}/existing.txt`, "hello")
    await $`git init -q`.cwd(tmpDir)
    await $`git add existing.txt`.cwd(tmpDir)
    await $`git -c user.email=test@example.com -c user.name=Test commit -q -m init`.cwd(tmpDir)
    clearFileCache()
  })

  afterEach(() => {
    clearFileCache()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("getFiles returns files and directories", async () => {
    const files = await getFiles(tmpDir)
    expect(files).toContain("existing.txt")
  })

  test("getFiles caches results and returns stale list immediately after a new file is created", async () => {
    const first = await getFiles(tmpDir)
    expect(first).toContain("existing.txt")
    expect(first).not.toContain("new-file.txt")

    writeFileSync(`${tmpDir}/new-file.txt`, "new")
    await $`git add new-file.txt`.cwd(tmpDir)

    const cached = await getFiles(tmpDir)
    expect(cached).not.toContain("new-file.txt")
  })

  test("clearFileCache forces getFiles to refresh", async () => {
    await getFiles(tmpDir)
    writeFileSync(`${tmpDir}/new-file.txt`, "new")
    await $`git add new-file.txt`.cwd(tmpDir)

    clearFileCache()
    const fresh = await getFiles(tmpDir)
    expect(fresh).toContain("new-file.txt")
  })

  test("fuzzyFilter includes newly created files after cache refresh", async () => {
    const files = await getFiles(tmpDir)
    expect(fuzzyFilter(files, "new")).toHaveLength(0)

    writeFileSync(`${tmpDir}/new-thing.txt`, "new")
    await $`git add new-thing.txt`.cwd(tmpDir)

    clearFileCache()
    const fresh = await getFiles(tmpDir)
    expect(fuzzyFilter(fresh, "new")).toContain("new-thing.txt")
  })
})
