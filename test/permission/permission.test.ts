import { describe, it, expect, beforeEach } from "bun:test"
import {
  evaluate,
  wildcardMatch,
  expandPath,
  disabled,
  ask,
  respond,
  listPending,
  clearSession,
  _reset,
  RejectedError,
  CorrectedError,
  DeniedError,
  type Ruleset,
} from "../../src/permission/permission"

describe("wildcardMatch", () => {
  it("matches exact strings", () => {
    expect(wildcardMatch("read", "read")).toBe(true)
    expect(wildcardMatch("read", "write")).toBe(false)
  })

  it("matches * wildcard", () => {
    expect(wildcardMatch("anything", "*")).toBe(true)
    expect(wildcardMatch("read", "re*")).toBe(true)
    expect(wildcardMatch("read", "*ad")).toBe(true)
    expect(wildcardMatch("read", "r*d")).toBe(true)
  })

  it("matches ? wildcard", () => {
    expect(wildcardMatch("read", "rea?")).toBe(true)
    expect(wildcardMatch("read", "r??d")).toBe(true)
    expect(wildcardMatch("read", "????")).toBe(true)
    expect(wildcardMatch("read", "?????")).toBe(false)
  })

  it("matches file path patterns", () => {
    expect(wildcardMatch("/src/foo/bar.ts", "/src/*")).toBe(true)
    expect(wildcardMatch("/src/foo/bar.ts", "/src/*.ts")).toBe(true)
    expect(wildcardMatch("/src/foo/bar.ts", "/other/*")).toBe(false)
  })

  it("handles trailing space+wildcard as optional", () => {
    expect(wildcardMatch("ls", "ls *")).toBe(true)
    expect(wildcardMatch("ls -la", "ls *")).toBe(true)
    expect(wildcardMatch("git", "ls *")).toBe(false)
  })

  it("normalizes path separators", () => {
    expect(wildcardMatch("src\\foo\\bar", "src/foo/*")).toBe(true)
  })

  it("handles empty strings", () => {
    expect(wildcardMatch("", "")).toBe(true)
    expect(wildcardMatch("", "*")).toBe(true)
    expect(wildcardMatch("foo", "")).toBe(false)
  })
})

describe("expandPath", () => {
  it("expands ~/", () => {
    const result = expandPath("~/foo/bar")
    expect(result).not.toStartWith("~")
    expect(result).toEndWith("/foo/bar")
  })

  it("expands $HOME/", () => {
    const result = expandPath("$HOME/foo")
    expect(result).not.toStartWith("$HOME")
    expect(result).toEndWith("/foo")
  })

  it("passes through other patterns", () => {
    expect(expandPath("/usr/bin")).toBe("/usr/bin")
    expect(expandPath("*.ts")).toBe("*.ts")
  })
})

describe("evaluate", () => {
  it("returns 'ask' when no rules match", () => {
    const rule = evaluate("read", "/foo.txt", [])
    expect(rule.action).toBe("ask")
  })

  it("matches exact tool + pattern", () => {
    const rules: Ruleset = [
      { tool: "read", pattern: "/src/*", action: "allow" },
    ]
    expect(evaluate("read", "/src/file.ts", rules).action).toBe("allow")
    expect(evaluate("write", "/src/file.ts", rules).action).toBe("ask")
  })

  it("last matching rule wins", () => {
    const rules: Ruleset = [
      { tool: "read", pattern: "*", action: "allow" },
      { tool: "read", pattern: "/secret/*", action: "deny" },
    ]
    expect(evaluate("read", "/src/file.ts", rules).action).toBe("allow")
    expect(evaluate("read", "/secret/keys.txt", rules).action).toBe("deny")
  })

  it("supports wildcard on permission name", () => {
    const rules: Ruleset = [
      { tool: "*", pattern: "*", action: "allow" },
    ]
    expect(evaluate("read", "/any/file.ts", rules).action).toBe("allow")
    expect(evaluate("bash", "ls -la", rules).action).toBe("allow")
  })

  it("merges multiple rulesets", () => {
    const base: Ruleset = [
      { tool: "*", pattern: "*", action: "ask" },
    ]
    const override: Ruleset = [
      { tool: "read", pattern: "*", action: "allow" },
    ]
    expect(evaluate("read", "/foo.txt", base, override).action).toBe("allow")
    expect(evaluate("write", "/foo.txt", base, override).action).toBe("ask")
  })
})

describe("disabled", () => {
  it("returns tools disabled by deny * rules", () => {
    const rules: Ruleset = [
      { tool: "bash", pattern: "*", action: "deny" },
    ]
    const result = disabled(["read", "write", "bash"], rules)
    expect(result.has("bash")).toBe(true)
    expect(result.has("read")).toBe(false)
  })

  it("maps edit-like tools to 'edit' permission", () => {
    const rules: Ruleset = [
      { tool: "edit", pattern: "*", action: "deny" },
    ]
    const result = disabled(["read", "write", "edit", "patch"], rules)
    expect(result.has("write")).toBe(true)
    expect(result.has("edit")).toBe(true)
    expect(result.has("patch")).toBe(true)
    expect(result.has("read")).toBe(false)
  })

  it("only disables for deny + pattern *", () => {
    const rules: Ruleset = [
      { tool: "bash", pattern: "/usr/bin/*", action: "deny" },
    ]
    const result = disabled(["bash"], rules)
    expect(result.has("bash")).toBe(false) // not disabled because pattern isn't "*"
  })
})

describe("ask / respond flow", () => {
  beforeEach(() => {
    _reset()
  })

  it("allow rule resolves immediately", async () => {
    const rules: Ruleset = [
      { tool: "read", pattern: "*", action: "allow" },
    ]
    // Should not throw or hang
    await ask({
      sessionId: "s1",
      tool: "read",
      pattern: "/foo.txt",
      ruleset: rules,
    })
  })

  it("deny rule throws DeniedError", async () => {
    const rules: Ruleset = [
      { tool: "bash", pattern: "*", action: "deny" },
    ]
    await expect(
      ask({
        sessionId: "s1",
        tool: "bash",
        pattern: "rm -rf /",
        ruleset: rules,
      }),
    ).rejects.toBeInstanceOf(DeniedError)
  })

  it("ask rule creates pending request, resolved by respond(once)", async () => {
    const rules: Ruleset = [] // no rules → default "ask"
    const promise = ask({
      sessionId: "s1",
      tool: "write",
      pattern: "/foo.txt",
      ruleset: rules,
    })

    const pending = listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0].tool).toBe("write")

    respond({ requestId: pending[0].id, reply: "once" })
    await promise // should resolve
  })

  it("respond(reject) throws RejectedError", async () => {
    const rules: Ruleset = []
    const promise = ask({
      sessionId: "s1",
      tool: "write",
      pattern: "/foo.txt",
      ruleset: rules,
    })

    const pending = listPending()
    respond({ requestId: pending[0].id, reply: "reject" })
    await expect(promise).rejects.toBeInstanceOf(RejectedError)
  })

  it("respond(reject) with message throws CorrectedError", async () => {
    const rules: Ruleset = []
    const promise = ask({
      sessionId: "s1",
      tool: "write",
      pattern: "/foo.txt",
      ruleset: rules,
    })

    const pending = listPending()
    respond({
      requestId: pending[0].id,
      reply: "reject",
      message: "Use a different path",
    })
    await expect(promise).rejects.toBeInstanceOf(CorrectedError)
  })

  it("respond(always) auto-approves future requests", async () => {
    const rules: Ruleset = []

    // First ask — needs manual approval
    const p1 = ask({
      sessionId: "s1",
      tool: "read",
      pattern: "/src/*",
      ruleset: rules,
    })

    const pending = listPending()
    respond({ requestId: pending[0].id, reply: "always" })
    await p1

    // Second ask — same pattern should be auto-approved
    await ask({
      sessionId: "s1",
      tool: "read",
      pattern: "/src/*",
      ruleset: rules,
    })
    // If it reaches here without hanging, the approval worked
  })

  it("respond(reject) rejects all pending for session", async () => {
    const rules: Ruleset = []
    const p1 = ask({ sessionId: "s1", tool: "write", pattern: "/a", ruleset: rules })
    const p2 = ask({ sessionId: "s1", tool: "write", pattern: "/b", ruleset: rules })

    const pending = listPending()
    expect(pending).toHaveLength(2)

    // Attach catch handlers before responding to prevent unhandled rejection
    const r1 = p1.catch((e) => e)
    const r2 = p2.catch((e) => e)

    // Reject first one — should also reject second
    respond({ requestId: pending[0].id, reply: "reject" })
    const e1 = await r1
    const e2 = await r2
    expect(e1).toBeInstanceOf(RejectedError)
    expect(e2).toBeInstanceOf(RejectedError)
    expect(listPending()).toHaveLength(0)
  })

  it("clearSession clears all state for session", async () => {
    const rules: Ruleset = []
    const promise = ask({ sessionId: "s1", tool: "read", pattern: "/a", ruleset: rules })

    expect(listPending()).toHaveLength(1)
    clearSession("s1")
    expect(listPending()).toHaveLength(0)
    await expect(promise).rejects.toBeInstanceOf(RejectedError)
  })
})
