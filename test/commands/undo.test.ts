// Undo command — integration tests
//
// Tests the snapshot engine, tracker persistence, and undo execution
// in a real filesystem with temp directories.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setSessionStorageRoot, getSessionStorageRoot } from "../../packages/runner/src/storage/session-path";
import { MemorySessionStore } from "../../packages/runner/src/session/store";
import { createSession, defaultSessionStore } from "../../packages/runner/src/session/session";
import { saveUserMessage, loadMessages } from "../../packages/runner/src/session/message";
import {
  setCurrentTurn,
  preTurnSnapshot,
  trackFile,
  takeSnapshot,
  undoLatest,
  clearHistory,
  extractFilePath,
  toolPreExecute,
} from "../../packages/runner/src/commands/undo";

let workspace: string;
let storageRoot: string;
const sessionId = "test-session-undo";
const turn1Id = "turn-msg-1";
const turn2Id = "turn-msg-2";

// Bun ignores a cleanup function returned from beforeEach, so the cwd/storage
// override below would leak into every later test file. Restore in afterEach.
const realCwd = process.cwd;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "quark-undo-workspace-"));
  storageRoot = mkdtempSync(join(tmpdir(), "quark-undo-storage-"));
  setSessionStorageRoot(storageRoot);

  // Change cwd to the temp workspace (restored after test)
  process.cwd = () => workspace;
});

afterEach(() => {
  process.cwd = realCwd;
  setSessionStorageRoot(undefined);
  rmSync(workspace, { recursive: true, force: true });
  rmSync(storageRoot, { recursive: true, force: true });
});

// Helper to create a file in the workspace
function createFile(relPath: string, content: string): void {
  const abs = join(workspace, relPath);
  const dir = join(workspace, relPath).split("/").slice(0, -1).join("/") || workspace;
  const { mkdirSync } = require("node:fs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(abs, content);
}

// Helper to read a file from workspace
function readFile(relPath: string): string {
  return readFileSync(join(workspace, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// extractFilePath
// ---------------------------------------------------------------------------

describe("extractFilePath", () => {
  test("extracts path from write tool args (reference convention)", () => {
    const result = extractFilePath("write", { path: "/tmp/foo.ts" });
    expect(result).toBe("/tmp/foo.ts");
  });

  test("extracts filePath from write tool args (legacy convention)", () => {
    const result = extractFilePath("write", { filePath: "/tmp/foo.ts" });
    expect(result).toBe("/tmp/foo.ts");
  });

  test("rejects conflicting targets rather than silently tracking the wrong file", () => {
    expect(() => extractFilePath("write", { path: "/tmp/a.ts", filePath: "/tmp/b.ts" })).toThrow(/unambiguous/);
  });

  test("resolves relative paths against cwd", () => {
    const result = extractFilePath("write", { path: "src/app.ts" });
    expect(result).toBe(resolve(workspace, "src/app.ts"));
  });

  test("returns null for non-file tools", () => {
    expect(extractFilePath("read", { path: "/tmp/foo.ts" })).toBeNull();
    expect(extractFilePath("bash", { command: "echo hi" })).toBeNull();
  });

  test("rejects missing targets for both filesystem tools", () => {
    for (const id of ["write", "edit"]) {
      expect(() => extractFilePath(id, {})).toThrow(/requires one unambiguous/);
      expect(() => extractFilePath(id, { path: "" })).toThrow(/requires one unambiguous/);
      expect(extractFilePath(id, { filePath: "src/app.ts" })).toBe(resolve(workspace, "src/app.ts"));
      expect(extractFilePath(id, { path: "src/app.ts" })).toBe(resolve(workspace, "src/app.ts"));
    }
  });
});

// ---------------------------------------------------------------------------
// Core undo flow: snapshot → modify → undo → verify restored
// ---------------------------------------------------------------------------

describe("undo flow", () => {
  test("custom store undo refuses before changing files or global JSONL", async () => {
    const custom = new MemorySessionStore();
    const id = `undo-isolation-${Date.now()}`;
    const global = createSession({ id }, defaultSessionStore);
    createSession({ id }, custom);
    const globalMessage = saveUserMessage({ sessionId: global.id, text: "global", store: defaultSessionStore });
    saveUserMessage({ sessionId: id, text: "custom", store: custom });
    createFile("protected.ts", "original");
    setCurrentTurn(id, globalMessage.id);
    await trackFile(id, "protected.ts");
    await takeSnapshot(id, globalMessage.id, ["protected.ts"]);
    writeFileSync(join(workspace, "protected.ts"), "changed");

    await expect(undoLatest(id, custom)).rejects.toThrow("Undo is unavailable for this session store");
    expect(readFile("protected.ts")).toBe("changed");
    expect(loadMessages(id, defaultSessionStore).messages).toHaveLength(1);
    expect(loadMessages(id, custom).messages).toHaveLength(1);
    clearHistory(id);
  });
  test("snapshot, modify, undo restores file content", async () => {
    createFile("src/app.ts", "original content");

    setCurrentTurn(sessionId, turn1Id);
    await trackFile(sessionId, "src/app.ts");
    await takeSnapshot(sessionId, turn1Id, ["src/app.ts"]);

    // Simulate agent modification
    writeFileSync(join(workspace, "src/app.ts"), "modified content");

    const result = await undoLatest(sessionId);
    expect(result).not.toBeNull();
    expect(result!.restored).toEqual(["src/app.ts"]);
    expect(result!.deleted).toEqual([]);

    expect(readFile("src/app.ts")).toBe("original content");
  });

  test("undo deletes files created during the turn", async () => {
    // File doesn't exist before turn — write tool creates it
    setCurrentTurn(sessionId, turn1Id);
    await trackFile(sessionId, "new-file.md");
    // No snapshot taken (file didn't exist yet)

    // Simulate agent creating the file
    createFile("new-file.md", "newly created");

    const result = await undoLatest(sessionId);
    expect(result).not.toBeNull();
    expect(result!.restored).toEqual([]);
    expect(result!.deleted).toEqual(["new-file.md"]);

    expect(existsSync(join(workspace, "new-file.md"))).toBe(false);
  });

  test("undo restores correct state with multiple files", async () => {
    createFile("a.ts", "a-original");
    createFile("b.ts", "b-original");
    createFile("c.ts", "c-original");

    setCurrentTurn(sessionId, turn1Id);

    // Track and snapshot a.ts and b.ts (agent modifies these)
    await trackFile(sessionId, "a.ts");
    await trackFile(sessionId, "b.ts");
    await takeSnapshot(sessionId, turn1Id, ["a.ts", "b.ts"]);

    // Agent modifies them
    writeFileSync(join(workspace, "a.ts"), "a-modified");
    writeFileSync(join(workspace, "b.ts"), "b-modified");
    // c.ts is untouched

    const result = await undoLatest(sessionId);
    expect(result).not.toBeNull();
    expect(result!.restored.sort()).toEqual(["a.ts", "b.ts"]);
    expect(result!.deleted).toEqual([]);

    expect(readFile("a.ts")).toBe("a-original");
    expect(readFile("b.ts")).toBe("b-original");
    expect(readFile("c.ts")).toBe("c-original"); // unchanged
  });

  test("undo handles files in subdirectories", async () => {
    createFile("src/utils/helper.ts", "original helper");

    setCurrentTurn(sessionId, turn1Id);
    await trackFile(sessionId, "src/utils/helper.ts");
    await takeSnapshot(sessionId, turn1Id, ["src/utils/helper.ts"]);

    writeFileSync(join(workspace, "src/utils/helper.ts"), "modified helper");

    const result = await undoLatest(sessionId);
    expect(result).not.toBeNull();
    expect(result!.restored).toEqual(["src/utils/helper.ts"]);

    expect(readFile("src/utils/helper.ts")).toBe("original helper");
  });
});

// ---------------------------------------------------------------------------
// Chained undo (multiple turns)
// ---------------------------------------------------------------------------

describe("chained undo", () => {
  test("chained undo walks back multiple turns", async () => {
    createFile("shared.ts", "version-0");

    // Turn 1: modify shared.ts
    setCurrentTurn(sessionId, turn1Id);
    await trackFile(sessionId, "shared.ts");
    await takeSnapshot(sessionId, turn1Id, ["shared.ts"]);
    writeFileSync(join(workspace, "shared.ts"), "version-1");

    // Turn 2: modify shared.ts again + create new file
    setCurrentTurn(sessionId, turn2Id);
    await trackFile(sessionId, "shared.ts");
    await trackFile(sessionId, "new.ts");
    await takeSnapshot(sessionId, turn2Id, ["shared.ts"]); // shared.ts only — new.ts is new
    writeFileSync(join(workspace, "shared.ts"), "version-2");
    createFile("new.ts", "new file");

    // Undo turn 2
    const result2 = await undoLatest(sessionId);
    expect(result2).not.toBeNull();
    expect(result2!.messageId).toBe(turn2Id);
    expect(readFile("shared.ts")).toBe("version-1");
    expect(existsSync(join(workspace, "new.ts"))).toBe(false);

    // Undo turn 1
    const result1 = await undoLatest(sessionId);
    expect(result1).not.toBeNull();
    expect(result1!.messageId).toBe(turn1Id);
    expect(readFile("shared.ts")).toBe("version-0");
  });

  test("undoLatest returns null when no turns remain", async () => {
    const result = await undoLatest(sessionId);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toolPreExecute (lazy snapshot + track)
// ---------------------------------------------------------------------------

describe("toolPreExecute", () => {
  for (const id of ["write", "edit"]) {
    for (const key of ["path", "filePath"]) {
      test(`${id} with ${key} snapshots before mutation and restores on undo`, async () => {
        createFile(`${id}-${key}.txt`, "before");
        setCurrentTurn(sessionId, turn1Id);
        await toolPreExecute(sessionId, extractFilePath(id, { [key]: `${id}-${key}.txt` })!);
        writeFileSync(join(workspace, `${id}-${key}.txt`), "after");
        expect((await undoLatest(sessionId))?.restored).toEqual([`${id}-${key}.txt`]);
        expect(readFile(`${id}-${key}.txt`)).toBe("before");
      });
    }
  }
  test("snapshots and tracks a file lazily", async () => {
    createFile("lazy.ts", "lazy-original");

    setCurrentTurn(sessionId, turn1Id);
    await toolPreExecute(sessionId, join(workspace, "lazy.ts"));

    // Modify the file
    writeFileSync(join(workspace, "lazy.ts"), "lazy-modified");

    // Undo
    const result = await undoLatest(sessionId);
    expect(result).not.toBeNull();
    expect(result!.restored).toEqual(["lazy.ts"]);
    expect(readFile("lazy.ts")).toBe("lazy-original");
  });

  test("tracks and restores files outside workspace", async () => {
    // Create a file outside the workspace (in OS tmpdir)
    const externalPath = join(tmpdir(), "quark-undo-external-test.txt");
    writeFileSync(externalPath, "external-original");
    try {
      setCurrentTurn(sessionId, turn1Id);
      await toolPreExecute(sessionId, externalPath);

      // Modify the external file
      writeFileSync(externalPath, "external-modified");

      const result = await undoLatest(sessionId);
      expect(result).not.toBeNull();
      expect(result!.restored).toEqual([externalPath]);
      expect(result!.deleted).toEqual([]);
      expect(result!.messageId).toBe(turn1Id);

      // External file should be restored to original content
      expect(readFileSync(externalPath, "utf-8")).toBe("external-original");
    } finally {
      rmSync(externalPath, { force: true });
    }
  });

  test("undo deletes external files created during the turn", async () => {
    const externalPath = join(tmpdir(), "quark-undo-external-new.txt");
    // File does NOT exist before the turn
    setCurrentTurn(sessionId, turn1Id);
    await toolPreExecute(sessionId, externalPath);
    // No snapshot taken (file didn't exist) — simulate agent creating it
    writeFileSync(externalPath, "external-new");

    const result = await undoLatest(sessionId);
    expect(result).not.toBeNull();
    expect(result!.restored).toEqual([]);
    expect(result!.deleted).toEqual([externalPath]);
    expect(existsSync(externalPath)).toBe(false);
  });

  test("external files use hash-based snapshot keys", async () => {
    const externalPathA = join(tmpdir(), "quark-undo-ext-a.txt");
    const externalPathB = join(tmpdir(), "quark-undo-ext-b.txt");
    writeFileSync(externalPathA, "content-a");
    writeFileSync(externalPathB, "content-b");
    try {
      // Snapshot both without tracking
      setCurrentTurn(sessionId, turn1Id);
      await takeSnapshot(sessionId, turn1Id, [externalPathA, externalPathB]);

      // External files are stored under a `files/` subdirectory with hash keys
      const dir = join(storageRoot, sessionId, "undo", turn1Id, "files");
      const entries = readdirSync(dir);
      expect(entries.length).toBe(2);
      entries.sort();
      // Two distinct hash-based keys
      expect(entries[0]).not.toBe(entries[1]);
    } finally {
      rmSync(externalPathA, { force: true });
      rmSync(externalPathB, { force: true });
    }
  });

  test("only snapshots a file once per turn", async () => {
    createFile("multi.ts", "multi-original");

    setCurrentTurn(sessionId, turn1Id);

    // First modification: snapshot should happen
    await toolPreExecute(sessionId, join(workspace, "multi.ts"));
    writeFileSync(join(workspace, "multi.ts"), "multi-v1");

    // Second modification (same turn): no duplicate snapshot
    await toolPreExecute(sessionId, join(workspace, "multi.ts"));
    writeFileSync(join(workspace, "multi.ts"), "multi-v2");

    // Undo should restore to original (first snapshot)
    const result = await undoLatest(sessionId);
    expect(result).not.toBeNull();
    expect(readFile("multi.ts")).toBe("multi-original");
  });
});

// ---------------------------------------------------------------------------
// preTurnSnapshot (proactive snapshot)
// ---------------------------------------------------------------------------

describe("preTurnSnapshot", () => {
  test("proactively snapshots files from previous turn", async () => {
    createFile("proactive.ts", "proactive-original");

    // Turn 1: track and modify the file
    setCurrentTurn(sessionId, turn1Id);
    await trackFile(sessionId, "proactive.ts");
    await takeSnapshot(sessionId, turn1Id, ["proactive.ts"]);
    writeFileSync(join(workspace, "proactive.ts"), "proactive-v1");

    // Turn 2: proactive snapshot of files from turn 1
    setCurrentTurn(sessionId, turn2Id);
    await preTurnSnapshot(sessionId, turn2Id);

    // Now modify in turn 2
    writeFileSync(join(workspace, "proactive.ts"), "proactive-v2");
    await trackFile(sessionId, "proactive.ts");

    // Undo turn 2 — should restore to proactive-v1
    const result = await undoLatest(sessionId);
    expect(result).not.toBeNull();
    expect(result!.messageId).toBe(turn2Id);
    expect(readFile("proactive.ts")).toBe("proactive-v1");
  });
});

// ---------------------------------------------------------------------------
// JSONL rewrite on undo
// ---------------------------------------------------------------------------

function writeSessionJSONL(sessionId: string, lines: string[]): void {
  const dir = join(getSessionStorageRoot(), sessionId);
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, "session.jsonl");
  writeFileSync(logPath, lines.join("\n") + "\n");
}

function readSessionJSONL(sessionId: string): string[] {
  const logPath = join(getSessionStorageRoot(), sessionId, "session.jsonl");
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf-8")
    .split("\n")
    .filter((line) => line.trim());
}

describe("JSONL rewrite on undo", () => {
  test("undo truncates the undone turn from session.jsonl", async () => {
    createFile("jsonl-undo.ts", "original");

    writeSessionJSONL(sessionId, [
      JSON.stringify({ v: 1, ts: 1, sessionId, type: "session", session: { id: sessionId, title: null, directory: workspace, parentSessionId: null, kind: "main", summary: null, parentSummary: null, filesModified: null, timeCreated: 1, timeUpdated: 1 } }),
      JSON.stringify({ v: 1, ts: 2, sessionId, type: "message", messageId: turn1Id, role: "user", modelId: null, providerId: null, timeCreated: 2 }),
      JSON.stringify({ v: 1, ts: 3, sessionId, type: "part", messageId: turn1Id, partId: "part-user-1", partType: "text", data: { text: "hello" } }),
      JSON.stringify({ v: 1, ts: 4, sessionId, type: "message-end", messageId: turn1Id, finish: "stop", cost: null, tokensIn: null, tokensOut: null, timeCompleted: 4 }),
      JSON.stringify({ v: 1, ts: 5, sessionId, type: "message", messageId: "assistant-1", role: "assistant", modelId: "test/model", providerId: "test", timeCreated: 5 }),
      JSON.stringify({ v: 1, ts: 6, sessionId, type: "part", messageId: "assistant-1", partId: "part-assistant-1", partType: "text", data: { text: "hi" } }),
      JSON.stringify({ v: 1, ts: 7, sessionId, type: "message-end", messageId: "assistant-1", finish: "stop", cost: null, tokensIn: null, tokensOut: null, timeCompleted: 7 }),
    ]);

    setCurrentTurn(sessionId, turn1Id);
    await trackFile(sessionId, "jsonl-undo.ts");
    await takeSnapshot(sessionId, turn1Id, ["jsonl-undo.ts"]);

    writeFileSync(join(workspace, "jsonl-undo.ts"), "modified");

    const result = await undoLatest(sessionId);
    expect(result).not.toBeNull();
    expect(result!.messageId).toBe(turn1Id);
    expect(readFile("jsonl-undo.ts")).toBe("original");

    const lines = readSessionJSONL(sessionId);
    expect(lines.length).toBe(1);
    const onlyEvent = JSON.parse(lines[0]!);
    expect(onlyEvent.type).toBe("session");

    const allText = lines.join("\n");
    expect(allText).not.toContain(turn1Id);
    expect(allText).not.toContain("assistant-1");
  });

  test("undo with two turns truncates to the previous turn", async () => {
    createFile("jsonl-undo2.ts", "original");

    writeSessionJSONL(sessionId, [
      JSON.stringify({ v: 1, ts: 1, sessionId, type: "session", session: { id: sessionId, title: null, directory: workspace, parentSessionId: null, kind: "main", summary: null, parentSummary: null, filesModified: null, timeCreated: 1, timeUpdated: 1 } }),
      JSON.stringify({ v: 1, ts: 2, sessionId, type: "message", messageId: turn1Id, role: "user", modelId: null, providerId: null, timeCreated: 2 }),
      JSON.stringify({ v: 1, ts: 3, sessionId, type: "part", messageId: turn1Id, partId: "part-user-1", partType: "text", data: { text: "first" } }),
      JSON.stringify({ v: 1, ts: 4, sessionId, type: "message-end", messageId: turn1Id, finish: "stop", cost: null, tokensIn: null, tokensOut: null, timeCompleted: 4 }),
      JSON.stringify({ v: 1, ts: 5, sessionId, type: "message", messageId: turn2Id, role: "user", modelId: null, providerId: null, timeCreated: 5 }),
      JSON.stringify({ v: 1, ts: 6, sessionId, type: "part", messageId: turn2Id, partId: "part-user-2", partType: "text", data: { text: "second" } }),
      JSON.stringify({ v: 1, ts: 7, sessionId, type: "message-end", messageId: turn2Id, finish: "stop", cost: null, tokensIn: null, tokensOut: null, timeCompleted: 7 }),
    ]);

    // Simulate two tracked turns: turn1 nothing, turn2 touches a file
    setCurrentTurn(sessionId, turn1Id);
    await trackFile(sessionId, "jsonl-undo2.ts");
    await takeSnapshot(sessionId, turn1Id, ["jsonl-undo2.ts"]);

    // Manually add a second turn entry to the tracker
    setCurrentTurn(sessionId, turn2Id);
    await trackFile(sessionId, "jsonl-undo2.ts");

    writeFileSync(join(workspace, "jsonl-undo2.ts"), "modified");

    const result = await undoLatest(sessionId);
    expect(result).not.toBeNull();
    expect(result!.messageId).toBe(turn2Id);

    const lines = readSessionJSONL(sessionId);
    const allText = lines.join("\n");
    expect(allText).toContain(turn1Id);
    expect(allText).not.toContain(turn2Id);
  });
});

// ---------------------------------------------------------------------------
// clearHistory
// ---------------------------------------------------------------------------

describe("clearHistory", () => {
  test("clears all undo data for a session", async () => {
    createFile("cleanup.ts", "cleanup-original");

    setCurrentTurn(sessionId, turn1Id);
    await trackFile(sessionId, "cleanup.ts");
    await takeSnapshot(sessionId, turn1Id, ["cleanup.ts"]);

    clearHistory(sessionId);

    // After clear, nothing to undo
    const result = await undoLatest(sessionId);
    expect(result).toBeNull();
  });
});
