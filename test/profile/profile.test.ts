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

  test("copies all profile fields to agent", () => {
    const profile = {
      ...BUILTIN_CODER,
      skills: ["test-skill"],
    }
    const agent = agentFromProfile(profile, "test")
    expect(agent.skills).toEqual(["test-skill"])
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

  test("profile has no maxSteps or contextLimitTokens fields", () => {
    const raw = {
      profiles: {
        basic: {
          tools: ["read"],
        },
      },
    }

    const profiles = parseProfilesFromYAML(raw, "/tmp")
    expect(profiles.basic).not.toHaveProperty("maxSteps")
    expect(profiles.basic).not.toHaveProperty("contextLimitTokens")
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

// ---------------------------------------------------------------------------
// profileSkills — filtering skills by profile binding
// ---------------------------------------------------------------------------

describe("profileSkills", () => {
  const { profileSkills, discoverSkills, clearCache } = require("../../src/skill/skill")
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atom-profileskills-test-"))
    clearCache()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    clearCache()
  })

  function writeSkill(dir: string, name: string, description: string, content: string) {
    const skillDir = path.join(dir, name)
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n${content}`,
    )
  }

  test("returns empty array when no skill names given", () => {
    writeSkill(tmpDir, "alpha", "Alpha", "alpha content")
    discoverSkills([tmpDir])
    const result = profileSkills([])
    expect(result).toEqual([])
  })

  test("filters to only profile-bound skill names", () => {
    writeSkill(tmpDir, "alpha", "Alpha skill", "alpha content")
    writeSkill(tmpDir, "beta", "Beta skill", "beta content")
    writeSkill(tmpDir, "gamma", "Gamma skill", "gamma content")
    discoverSkills([tmpDir])

    const result = profileSkills(["alpha", "gamma"])
    expect(result).toHaveLength(2)
    const names = result.map((s: any) => s.name).sort()
    expect(names).toEqual(["alpha", "gamma"])
  })

  test("ignores skill names that don't exist", () => {
    writeSkill(tmpDir, "alpha", "Alpha skill", "alpha content")
    discoverSkills([tmpDir])

    const result = profileSkills(["alpha", "nonexistent"])
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("alpha")
  })

  test("returns empty when no matching skills found", () => {
    writeSkill(tmpDir, "alpha", "Alpha skill", "alpha content")
    discoverSkills([tmpDir])

    const result = profileSkills(["nonexistent"])
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// buildSkillTool — profile-filtered skill tool
// ---------------------------------------------------------------------------

describe("buildSkillTool", () => {
  const { clearCache, discoverSkills } = require("../../src/skill/skill")
  const { buildSkillTool } = require("../../src/tool/skill")
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atom-skilltool-test-"))
    clearCache()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    clearCache()
  })

  function writeSkill(dir: string, name: string, description: string, content: string) {
    const skillDir = path.join(dir, name)
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n${content}`,
    )
  }

  test("no boundSkills — description lists all discovered skills", () => {
    writeSkill(tmpDir, "alpha", "Alpha skill", "alpha content")
    writeSkill(tmpDir, "beta", "Beta skill", "beta content")
    discoverSkills([tmpDir])

    const tool = buildSkillTool()
    expect(tool.description).toContain("alpha")
    expect(tool.description).toContain("beta")
  })

  test("boundSkills filters description to only bound skills", () => {
    writeSkill(tmpDir, "alpha", "Alpha skill", "alpha content")
    writeSkill(tmpDir, "beta", "Beta skill", "beta content")
    writeSkill(tmpDir, "gamma", "Gamma skill", "gamma content")
    discoverSkills([tmpDir])

    const tool = buildSkillTool(["alpha", "gamma"])
    expect(tool.description).toContain("alpha")
    expect(tool.description).toContain("gamma")
    expect(tool.description).not.toContain("beta")
  })

  test("empty boundSkills array shows all skills", () => {
    writeSkill(tmpDir, "alpha", "Alpha skill", "alpha content")
    discoverSkills([tmpDir])

    const tool = buildSkillTool([])
    // Empty array means no profile binding — falls through to discoverSkills
    expect(tool.description).toContain("alpha")
  })

  test("description shows 'no skills available' when none match", () => {
    discoverSkills([tmpDir]) // empty dir

    const tool = buildSkillTool(["nonexistent"])
    expect(tool.description).toContain("No skills are currently available")
  })

  test("execute loads a skill by name", async () => {
    writeSkill(tmpDir, "alpha", "Alpha skill", "Do alpha things.")
    discoverSkills([tmpDir])

    const tool = buildSkillTool()
    const ctx = { sessionId: "s1", messageId: "m1", abort: new AbortController().signal, messages: [], ask: async () => {} }
    const result = await tool.execute({ name: "alpha" }, ctx)
    expect(result.title).toBe("Loaded skill: alpha")
    expect(result.output).toContain("Do alpha things.")
    expect(result.output).toContain('<skill_content name="alpha">')
    expect(result.metadata.name).toBe("alpha")
  })

  test("execute throws for non-existent skill", async () => {
    writeSkill(tmpDir, "alpha", "Alpha skill", "content")
    discoverSkills([tmpDir])

    const tool = buildSkillTool(["alpha"])
    const ctx = { sessionId: "s1", messageId: "m1", abort: new AbortController().signal, messages: [], ask: async () => {} }

    await expect(tool.execute({ name: "nonexistent" }, ctx)).rejects.toThrow("not found")
  })

  test("execute error message lists available skills when bound", async () => {
    writeSkill(tmpDir, "alpha", "Alpha skill", "content")
    writeSkill(tmpDir, "beta", "Beta skill", "content")
    discoverSkills([tmpDir])

    const tool = buildSkillTool(["alpha"])
    const ctx = { sessionId: "s1", messageId: "m1", abort: new AbortController().signal, messages: [], ask: async () => {} }

    try {
      await tool.execute({ name: "missing" }, ctx)
      expect(true).toBe(false) // should not reach
    } catch (e: any) {
      expect(e.message).toContain("alpha")
      // beta should NOT be listed since it's not bound
      expect(e.message).not.toContain("beta")
    }
  })
})

// ---------------------------------------------------------------------------
// buildSystem — L1 skill metadata in system prompt
// ---------------------------------------------------------------------------

describe("buildSystem with skills", () => {
  const { clearCache, discoverSkills } = require("../../src/skill/skill")
  const { buildSystem } = require("../../src/session/system")
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atom-system-test-"))
    clearCache()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    clearCache()
  })

  function writeSkill(dir: string, name: string, description: string, content: string) {
    const skillDir = path.join(dir, name)
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n${content}`,
    )
  }

  test("no skills — system prompt has no skill block", () => {
    const agent = { id: "test", name: "Test", prompt: "You are a test agent.", tools: [], skills: [] }
    const parts = buildSystem(agent)
    const joined = parts.join("\n")
    expect(joined).not.toContain("Available Skills")
    expect(joined).toContain("You are a test agent.")
    expect(joined).toContain("Working directory:")
  })

  test("with bound skills — system prompt includes L1 metadata", () => {
    writeSkill(tmpDir, "code-review", "Review code for quality", "Full review instructions...")
    writeSkill(tmpDir, "git-release", "Manage git releases", "Full release instructions...")
    discoverSkills([tmpDir])

    const agent = { id: "test", name: "Test", prompt: "You are a coder.", tools: [], skills: ["code-review", "git-release"] }
    const parts = buildSystem(agent)
    const joined = parts.join("\n")

    expect(joined).toContain("# Available Skills")
    expect(joined).toContain("code-review")
    expect(joined).toContain("Review code for quality")
    expect(joined).toContain("git-release")
    expect(joined).toContain("Manage git releases")
    // L2 content (SKILL.md body) should NOT be in the system prompt
    expect(joined).not.toContain("Full review instructions")
    expect(joined).not.toContain("Full release instructions")
  })

  test("skills not in profile are not included", () => {
    writeSkill(tmpDir, "bound-skill", "I am bound", "bound content")
    writeSkill(tmpDir, "unbound-skill", "I am unbound", "unbound content")
    discoverSkills([tmpDir])

    const agent = { id: "test", name: "Test", prompt: "Test.", tools: [], skills: ["bound-skill"] }
    const parts = buildSystem(agent)
    const joined = parts.join("\n")

    expect(joined).toContain("bound-skill")
    expect(joined).not.toContain("unbound-skill")
  })

  test("system prompt always includes environment block", () => {
    const agent = { id: "test", name: "Test", prompt: "Test.", tools: [], skills: [] }
    const parts = buildSystem(agent)
    const joined = parts.join("\n")
    expect(joined).toContain("Working directory:")
    expect(joined).toContain("OS:")
    expect(joined).toContain("Today's date:")
  })
})

// ---------------------------------------------------------------------------
// /profile command in commands registry
// ---------------------------------------------------------------------------

describe("/profile command", () => {
  const { filterCommands, commands } = require("../../src/tui/commands")

  test("profile command exists in commands list", () => {
    const profileCmd = commands.find((c: any) => c.id === "profile")
    expect(profileCmd).toBeDefined()
    expect(profileCmd.description).toContain("profile")
    expect(profileCmd.usage).toBe("<profile-name>")
  })

  test("filterCommands matches /profile", () => {
    const result = filterCommands("profile")
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("profile")
  })

  test("filterCommands 'p' prefix matches profile", () => {
    const result = filterCommands("p")
    const ids = result.map((c: any) => c.id)
    expect(ids).toContain("profile")
  })
})
