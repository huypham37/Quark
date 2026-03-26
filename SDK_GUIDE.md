# Atom SDK - Quick Reference

## What Was Done

Transformed Atom from a CLI-only app into a publishable SDK package.

## Files Created/Modified

### Created:
- `tsup.config.ts` - Build configuration
- `tsconfig.build.json` - TypeScript build settings
- `SDK_USAGE.md` - Usage documentation
- `test-sdk/test-import.ts` - Import test

### Modified:
- `src/index.ts` - Added missing type exports (ToolDef, ToolContext, Session, etc.)
- `package.json` - Configured for SDK distribution
- Added dependencies: `tsup`, `@types/node`

## Build Output

```
dist/
├── index.js           # ESM bundle
├── index.cjs          # CommonJS bundle
├── index.d.ts         # TypeScript types (entry)
├── src/               # Full type definitions
│   ├── index.d.ts
│   ├── tool/tool.d.ts
│   └── ...
```

## Usage

### Build the SDK
```bash
bun run build
```

### Import in Projects
```typescript
// ESM
import { createSession, prompt, register } from '@atom/sdk'

// CommonJS
const { createSession, prompt } = require('@atom/sdk')
```

### Verify Build
```bash
cd test-sdk
bun run test-import.ts
```

## What's Exported

### Functions
- Session: `bootstrap`, `createSession`, `getSession`, `prompt`, `cancel`
- Tools: `register`, `defineTool`, `listTools`
- Permissions: `evaluatePermission`, `askPermission`, etc.
- Profiles: `resolveProfile`, `listProfiles`, `readPromptFile`
- Events: `bus`

### Types
- `ToolDef`, `ToolContext`, `ToolResult`
- `Session`, `SessionKind`
- `AgentConfig`, `ProfileDef`, `ProfileConfig`
- `BusEvents`, `BusEventName`
- Permission types: `Rule`, `Ruleset`, `Action`, `Reply`

## Publishing (when ready)

1. Remove `"private": true` if still present
2. Update version in package.json
3. Run `npm publish` or `bun publish`

## Notes

- Requires Bun runtime for database operations (`bun:sqlite`)
- UI/TUI components excluded from SDK build
- Full TypeScript support with `.d.ts` files
