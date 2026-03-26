# Atom SDK Test Suite

Comprehensive test suite for the Atom SDK package (`@atom/sdk`).

## Quick Start

```bash
# Run all SDK tests
bun test ./test-sdk/sdk.test.ts

# Or use the test directory pattern
bun test test-sdk
```

## Test Files

- **`test-sdk/sdk.test.ts`** - Main test suite (35 tests)
- **`test-specs/test-plan.md`** - Detailed test plan and strategy
- **`test-specs/test-cases.json`** - Structured test case definitions
- **`test-specs/test-report.md`** - Comprehensive test execution report
- **`test-specs/findings.json`** - Bug/issue tracking (currently empty)
- **`test-specs/test-execution.log`** - Latest test run output

## Requirements

- **Bun** v1.3.10 or later (required for `bun:sqlite`)
- SDK must be built first: `bun run build`

## Test Coverage

### Categories Tested

1. **Type Definitions** (8 tests)
   - ToolDef, ToolContext, ToolResult
   - Session, SessionKind
   - AgentConfig, ProfileDef
   - Permission types (Action, Rule, Reply, Ruleset)

2. **ESM Bundle** (3 tests)
   - All exports accessible
   - Functions callable
   - Objects have correct structure

3. **CJS Bundle** (3 tests)
   - Bundle can be imported
   - Exports match ESM
   - Default export present

4. **Session Management** (6 tests)
   - bootstrap() initialization
   - createSession() with various options
   - getSession() retrieval
   - Error handling

5. **Tool System** (4 tests)
   - defineTool() creation
   - Zod schema validation
   - register() and listTools()

6. **Event Bus** (4 tests)
   - on/off/once handlers
   - Multiple event types
   - Event emission

7. **Agent Configuration** (2 tests)
   - defaultAgent structure
   - agentFromProfile() conversion

8. **Integration** (1 test)
   - Complete SDK_USAGE.md workflow

9. **Edge Cases** (4 tests)
   - Complex Zod schemas
   - Nullable fields
   - Permission rulesets
   - Event type safety

**Total: 35 tests, 100% pass rate**

## Test Structure

Each test follows this pattern:

```typescript
describe("Category", () => {
  test("Test case description", async () => {
    // Arrange
    const data = setupTestData()
    
    // Act
    const result = await functionUnderTest(data)
    
    // Assert
    expect(result).toBe(expected)
  })
})
```

## Database Isolation

Tests use isolated SQLite databases to prevent interference:

```typescript
beforeEach(() => {
  testDbPath = path.join(process.cwd(), `test-sdk-${Date.now()}.db`)
  process.env.ATOM_DB_PATH = testDbPath
})

afterAll(() => {
  // Cleanup test databases
})
```

## What's NOT Tested

- ❌ LLM API calls (requires API keys, real network)
- ❌ Actual prompt execution (integration concern)
- ❌ TUI components (UI testing out of scope)
- ❌ CLI commands (separate testing)
- ❌ Node.js compatibility (SDK requires Bun)

## Test Results

Last run: **March 26, 2026**

```
✅ 35 tests passed
❌ 0 tests failed
⏱️  368ms execution time
```

See `test-specs/test-report.md` for detailed results.

## Adding New Tests

1. Add test case to `sdk.test.ts` in appropriate `describe()` block
2. Update `test-specs/test-cases.json` with structured test case
3. Run tests: `bun test ./test-sdk/sdk.test.ts`
4. Update `test-specs/test-report.md` if needed

## Continuous Integration

Add to CI pipeline:

```yaml
- name: Test SDK
  run: |
    bun install
    bun run build
    bun test ./test-sdk/sdk.test.ts
```

## Troubleshooting

### "Cannot find module 'bun:sqlite'"

**Cause**: Running tests with Node.js instead of Bun
**Solution**: Use `bun test` instead of `npm test` or `node`

### "Session not found" errors

**Cause**: Database not initialized
**Solution**: Ensure `bootstrap()` is called in test setup

### Tests fail after code changes

**Cause**: API surface changed
**Solution**: Update tests to match new API, update test-cases.json

## Documentation

- **Test Plan**: `test-specs/test-plan.md`
- **Test Cases**: `test-specs/test-cases.json`
- **Test Report**: `test-specs/test-report.md`
- **SDK Usage**: `SDK_USAGE.md` (root directory)

## Contact

For questions or issues with the test suite, see the main project README.

---

**Status**: ✅ All tests passing
**Last Updated**: March 26, 2026
