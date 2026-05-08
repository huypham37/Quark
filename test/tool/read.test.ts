import { describe, test, expect } from "bun:test"
import { readTool } from "../../src/tool/read"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

function ctx() {
  return {
    sessionId: "test",
    messageId: "msg_1",
    callId: "call_1",
    abort: new AbortController().signal,
    ask: async () => {},
  }
}

describe("read tool", () => {
  test("handles missing path gracefully", async () => {
    // @ts-expect-error — testing with missing path
    const result = await readTool.execute({}, ctx())
    expect(result.title).toBe("Read error")
    expect(result.metadata.error).toBe("invalid_path")
  })

  test("handles undefined path gracefully", async () => {
    // @ts-expect-error — testing with undefined path
    const result = await readTool.execute({ path: undefined }, ctx())
    expect(result.title).toBe("Read error")
    expect(result.metadata.error).toBe("invalid_path")
  })

  test("handles empty string path gracefully", async () => {
    // @ts-expect-error — testing with empty path
    const result = await readTool.execute({ path: "" }, ctx())
    expect(result.title).toBe("Read error")
    expect(result.metadata.error).toBe("invalid_path")
  })

  test("handles whitespace-only path gracefully", async () => {
    const result = await readTool.execute({ path: "   " }, ctx())
    expect(result.title).toBe("Read error")
    expect(result.metadata.error).toBe("invalid_path")
  })

  test("reads a file and returns line-numbered content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quark-test-read-"))
    const filePath = join(dir, "test.txt")
    writeFileSync(filePath, "line1\nline2\nline3")

    const result = await readTool.execute({ path: filePath }, ctx())

    expect(result.title).toContain("Read")
    expect(result.metadata.type).toBe("file")
    expect(result.metadata.totalLines).toBe(3)
    expect(result.metadata.linesReturned).toBe(3)
    expect(result.output).toContain("1: line1")
    expect(result.output).toContain("2: line2")
    expect(result.output).toContain("3: line3")

    rmSync(dir, { recursive: true, force: true })
  })

  test("handles offset and limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quark-test-read-"))
    const filePath = join(dir, "test.txt")
    writeFileSync(filePath, "a\nb\nc\nd\ne\n")

    const result = await readTool.execute({ path: filePath, offset: 2, limit: 2 }, ctx())

    expect(result.metadata.offset).toBe(2)
    expect(result.metadata.linesReturned).toBe(2)
    expect(result.output).toContain("2: b")
    expect(result.output).toContain("3: c")
    expect(result.output).not.toContain("1: a")
    expect(result.output).not.toContain("4: d")

    rmSync(dir, { recursive: true, force: true })
  })

  test("returns error for non-existent file", async () => {
    const result = await readTool.execute({ path: "/tmp/nonexistent_file_xyz123" }, ctx())
    expect(result.metadata.error).toBe("not_found")
  })

  test("lists directory contents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quark-test-read-"))
    writeFileSync(join(dir, "a.txt"), "")
    writeFileSync(join(dir, "b.txt"), "")

    const result = await readTool.execute({ path: dir }, ctx())

    expect(result.metadata.type).toBe("directory")
    expect(result.metadata.entries).toBe(2)
    expect(result.output).toContain("a.txt")
    expect(result.output).toContain("b.txt")

    rmSync(dir, { recursive: true, force: true })
  })

  test("handles binary file detection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quark-test-read-"))
    const filePath = join(dir, "binary.bin")
    // Write a file with null bytes to simulate binary
    const buf = Buffer.alloc(100)
    buf[0] = 0x00
    buf[1] = 0x01
    buf[2] = 0x02
    writeFileSync(filePath, buf)

    const result = await readTool.execute({ path: filePath }, ctx())

    expect(result.metadata.type).toBe("binary")

    rmSync(dir, { recursive: true, force: true })
  })
})
