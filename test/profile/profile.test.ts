// Tests for profile system

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

import {
  resolveProfile,
  readPromptFile,
  listProfiles,
  resetProfileCache,
  loadProfileConfig,
  _internal,
} from "../../src/profile/profile"
import { agentFromProfile } from "../../src/agent"

const { parseProfilesFromYAML, parseProjectOverrides, BUILTIN_CODER } = _internal

// ---------------------------------------------------------------------------
// resolveProfile — fallback behavior
// ---------------------------------------------------------------------------

describe("resolveProfile", () => {
  beforeEach(() => resetProfileCache())
  afterEach(() => resetProfileCache())

  test("returns built-in coder when no config exists", () => {
    const profile = resolveProfile("coder")
    expect(profile.id).toBe("coder")
    expect(profile.tools).toContain("read")
    expect(profile.tools).toContain("bash")
    expect(profile.tools).toContain("skill")
    expect(profile.skills).toEqual([])
    expect(profile.maxSteps).toBe(100)
  })

  test("falls back to coder when unknown profile requested", () => {
    const profile = resolveProfile("nonexistent")
    expect(profile.id).toBe("coder")
  })

  test("returns coder when no profile specified", () => {
    const profile = resolveProfile()
    expect(profile.id).toBe("coder")
  })
})

// ---------------------------------------------------------------------------
// readPromptFile
// ---------------------------------------------------------------------------

describe("readPromptFile", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atom-profile-test-"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("returns builtin prompt when no promptFile set", () => {
    const profile = resolveProfile("coder")
    const prompt = readPromptFile(profile)
    expect(prompt).toContain("coding assistant")
  })

  test("reads from promptFile when set", () => {
    const promptPath = path.join(tmpDir, "test-prompt.md")
    fs.writeFileSync(promptPath, "You are a test agent.")

    const profile = {
      ...resolveProfile("coder"),
      promptFile: promptPath,
    }
    const prompt = readPromptFile(profile)
    expect(prompt).toBe("You are a test agent.")
  })

  test("falls back to builtin when file not found", () => {
    const profile = {
      ...resolveProfile("coder"),
      promptFile: "/nonexistent/path.md",
    }
    const prompt = readPromptFile(profile)
    expect(prompt).toContain("coding assistant")
  })

  test("trims whitespace from prompt file content", () => {
    const promptPath = path.join(tmpDir, "padded.md")
    fs.writeFileSync(promptPath, "  \nYou are padded.\n\n  ")

    const profile = {
      ...resolveProfile("coder"),
      promptFile: promptPath,
    }
    const prompt = readPromptFile(profile)
    expect(prompt).toBe("You are padded.")
  })
})

// ---------------------------------------------------------------------------
// agentFromProfile
// ---------------------------------------------------------------------------

describe("agentFromProfile", () => {
  test("creates AgentConfig from profile", () => {
    const profile = resolveProfile("coder")
    const prompt = readPromptFile(profile)
    const agent = agentFromProfile(profile, prompt)

    expect(agent.id).toBe("coder")
    expect(agent.prompt).toContain("coding assistant")
    expect(agent.tools).toEqual(profile.tools)
    expect(agent.skills).toEqual(profile.skills)
    expect(agent.maxSteps).toBe(profile.maxSteps)
  })

  test("preserves custom skills and tools from profile", () => {
    const profile = {
      ...BUILTIN_CODER,
      id: "researcher",
      name: "Researcher",
      tools: ["websearch", "webfetch"],
      skills: ["academic-research"],
    }
    const agent = agentFromProfile(profile, "You are a researcher.")

    expect(agent.id).toBe("researcher")
    expect(agent.prompt).toBe("You are a researcher.")
    expect(agent.tools).toEqual(["websearch", "webfetch"])
    expect(agent.skills).toEqual(["academic-research"])
  })

  test("preserves contextLimitTokens from profile", () => {
    const profile = {
      ...BUILTIN_CODER,
      contextLimitTokens: 200_000,
    }
    const agent = agentFromProfile(profile, "test")
    expect(agent.contextLimitTokens).toBe(200_000)
  })
})

// ---------------------------------------------------------------------------
// listProfiles
// ---------------------------------------------------------------------------

describe("listProfiles", () => {
  beforeEach(() => resetProfileCache())
  afterEach(() => resetProfileCache())

  test("includes built-in coder", () => {
    const profiles = listProfiles()
    expect(profiles).toContain("coder")
  })
})

// ---------------------------------------------------------------------------
// loadProfileConfig
// ---------------------------------------------------------------------------

describe("loadProfileConfig", () => {
  beforeEach(() => resetProfileCache())
  afterEach(() => resetProfileCache())

  test("returns valid config with defaults", () => {
    const config = loadProfileConfig()
    expect(config.defaultProfile).toBe("coder")
    expect(config.profiles.coder).toBeDefined()
    expect(config.profiles.coder.tools).toContain("read")
  })
})

// ---------------------------------------------------------------------------
// parseProfilesFromYAML — YAML config parsing
// ---------------------------------------------------------------------------

describe("parseProfilesFromYAML", () => {
  test("parses a complete profile definition", () => {
    const raw = {
      profiles: {
        researcher: {
          name: "Researcher",
          prompt_file: "profiles/researcher.md",
          tools: ["websearch", "webfetch", "write"],
          skills: ["academic-research", "competitive-intel"],
          max_steps: 50,
          context_limit_tokens: 200_000,
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/home/user/.atom")
    expect(profiles.researcher).toBeDefined()
    expect(profiles.researcher.id).toBe("researcher")
    expect(profiles.researcher.name).toBe("Researcher")
    expect(profiles.researcher.promptFile).toBe("/home/user/.atom/profiles/researcher.md")
    expect(profiles.researcher.tools).toEqual(["websearch", "webfetch", "write"])
    expect(profiles.researcher.skills).toEqual(["academic-research", "competitive-intel"])
    expect(profiles.researcher.maxSteps).toBe(50)
    expect(profiles.researcher.contextLimitTokens).toBe(200_000)
  })

  test("parses multiple profiles", () => {
    const raw = {
      profiles: {
        coder: {
          prompt_file: "profiles/coder.md",
          tools: ["read", "write", "edit", "bash"],
        },
        researcher: {
          prompt_file: "profiles/researcher.md",
          tools: ["websearch", "webfetch"],
          skills: ["academic-research"],
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/tmp/config")
    expect(Object.keys(profiles)).toHaveLength(2)
    expect(profiles.coder).toBeDefined()
    expect(profiles.researcher).toBeDefined()
  })

  test("uses id as name when name is not specified", () => {
    const raw = {
      profiles: {
        myprofile: {
          tools: ["read"],
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(profiles.myprofile.name).toBe("myprofile")
  })

  test("defaults to builtin tools when tools not specified", () => {
    const raw = {
      profiles: {
        minimal: {
          prompt_file: "profiles/minimal.md",
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(profiles.minimal.tools).toEqual(BUILTIN_CODER.tools)
  })

  test("defaults to empty skills when skills not specified", () => {
    const raw = {
      profiles: {
        noskills: {
          tools: ["read"],
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(profiles.noskills.skills).toEqual([])
  })

  test("defaults maxSteps and contextLimitTokens when not specified", () => {
    const raw = {
      profiles: {
        basic: {
          tools: ["read"],
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(profiles.basic.maxSteps).toBe(BUILTIN_CODER.maxSteps)
    expect(profiles.basic.contextLimitTokens).toBe(BUILTIN_CODER.contextLimitTokens)
  })

  test("resolves relative prompt_file paths against configDir", () => {
    const raw = {
      profiles: {
        test: {
          prompt_file: "profiles/test.md",
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/home/user/.atom")
    expect(profiles.test.promptFile).toBe("/home/user/.atom/profiles/test.md")
  })

  test("preserves absolute prompt_file paths", () => {
    const raw = {
      profiles: {
        test: {
          prompt_file: "/absolute/path/prompt.md",
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/home/user/.atom")
    expect(profiles.test.promptFile).toBe("/absolute/path/prompt.md")
  })

  test("sets empty promptFile when prompt_file not specified", () => {
    const raw = {
      profiles: {
        noprompt: {
          tools: ["read"],
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(profiles.noprompt.promptFile).toBe("")
  })

  test("returns empty when raw has no profiles key", () => {
    const raw = { something_else: "value" }
    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(Object.keys(profiles)).toHaveLength(0)
  })

  test("returns empty when profiles is not an object", () => {
    const raw = { profiles: "not-an-object" }
    const profiles = parseProfilesFromYAML(raw as any, "/tmp")
    expect(Object.keys(profiles)).toHaveLength(0)
  })

  test("skips non-object profile entries", () => {
    const raw = {
      profiles: {
        valid: { tools: ["read"] },
        invalid: "not-an-object",
        alsonull: null,
      },
    }

    const profiles = parseProfilesFromYAML(raw as any, "/tmp")
    expect(Object.keys(profiles)).toHaveLength(1)
    expect(profiles.valid).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// parseProjectOverrides — skills_add / tools_add
// ---------------------------------------------------------------------------

describe("parseProjectOverrides", () => {
  test("returns empty overrides when no profile_overrides key", () => {
    const raw = { profiles: {} }
    const result = parseProjectOverrides(raw, "coder")
    expect(result.skillsAdd).toEqual([])
    expect(result.toolsAdd).toEqual([])
  })

  test("returns empty overrides when profile not in overrides", () => {
    const raw = {
      profile_overrides: {
        researcher: {
          skills_add: ["extra-skill"],
        },
      },
    }
    const result = parseProjectOverrides(raw, "coder")
    expect(result.skillsAdd).toEqual([])
    expect(result.toolsAdd).toEqual([])
  })

  test("parses skills_add for matching profile", () => {
    const raw = {
      profile_overrides: {
        coder: {
          skills_add: ["django-patterns", "react-patterns"],
        },
      },
    }
    const result = parseProjectOverrides(raw, "coder")
    expect(result.skillsAdd).toEqual(["django-patterns", "react-patterns"])
    expect(result.toolsAdd).toEqual([])
  })

  test("parses tools_add for matching profile", () => {
    const raw = {
      profile_overrides: {
        coder: {
          tools_add: ["grep", "glob"],
        },
      },
    }
    const result = parseProjectOverrides(raw, "coder")
    expect(result.toolsAdd).toEqual(["grep", "glob"])
    expect(result.skillsAdd).toEqual([])
  })

  test("parses both skills_add and tools_add together", () => {
    const raw = {
      profile_overrides: {
        researcher: {
          skills_add: ["competitive-intel"],
          tools_add: ["webfetch"],
        },
      },
    }
    const result = parseProjectOverrides(raw, "researcher")
    expect(result.skillsAdd).toEqual(["competitive-intel"])
    expect(result.toolsAdd).toEqual(["webfetch"])
  })

  test("returns empty when profile_overrides is not an object", () => {
    const raw = { profile_overrides: "not-an-object" }
    const result = parseProjectOverrides(raw as any, "coder")
    expect(result.skillsAdd).toEqual([])
    expect(result.toolsAdd).toEqual([])
  })

  test("returns empty when profile override entry is not an object", () => {
    const raw = {
      profile_overrides: {
        coder: "not-an-object",
      },
    }
    const result = parseProjectOverrides(raw as any, "coder")
    expect(result.skillsAdd).toEqual([])
    expect(result.toolsAdd).toEqual([])
  })

  test("ignores non-array skills_add/tools_add", () => {
    const raw = {
      profile_overrides: {
        coder: {
          skills_add: "not-an-array",
          tools_add: 42,
        },
      },
    }
    const result = parseProjectOverrides(raw as any, "coder")
    expect(result.skillsAdd).toEqual([])
    expect(result.toolsAdd).toEqual([])
  })
})
