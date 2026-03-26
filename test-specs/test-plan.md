# Test Plan: Token Usage Feature

## Objective
Validate that the token usage tracking feature accurately captures, persists, and reports LLM API token consumption across message lifecycle, database operations, and event emissions.

## Test Strategy

### Approach
- **White-box testing**: Test internal token tracking logic with direct database access
- **Event-driven testing**: Verify event emissions contain correct token data
- **Integration testing**: Test token persistence across message creation, update, and retrieval
- **Boundary testing**: Test edge cases (null, zero, very large values)

### Techniques
1. Unit testing of individual functions (`finishMessage`, token aggregation)
2. Integration testing of database operations
3. Event listener verification for token-related events
4. Data validation (type checking, range validation)

### Test Types
- **Functional**: Token tracking accuracy, persistence, retrieval
- **Non-functional**: Performance (not in initial scope), data integrity
- **Regression**: Ensure existing message functionality isn't broken

## Environment

### Required Environment
- **Runtime**: Bun test runner
- **Database**: SQLite (in-memory or file-based via Drizzle ORM)
- **Dependencies**:
  - `bun:test` framework
  - Drizzle ORM for database access
  - `ai` package for types (ModelMessage, etc.)

### Tools
- Bun test runner with `describe`, `it`, `expect`
- Mock/spy capabilities for event emission testing
- Database fixtures for test data setup

## Entry/Exit Criteria

### Entry Criteria
1. Token usage feature implementation is complete
2. Database schema includes token fields (`tokensIn`, `tokensOut`, `cost`)
3. Event bus supports token-related events
4. Test environment is configured with Bun

### Exit Criteria
1. All test cases pass (100% pass rate)
2. Code coverage >= 80% for token-related code paths
3. No critical or high-severity bugs found
4. Test execution time < 5 seconds
5. Documentation updated with token tracking behavior

## Risks & Mitigations

### Risks
1. **Database state pollution**: Tests may interfere with each other
   - **Mitigation**: Use isolated database instances per test or proper cleanup
   
2. **Async event timing**: Events may be emitted before listeners are ready
   - **Mitigation**: Use `Promise` wrappers and `once()` for event assertions

3. **Floating-point precision**: Cost calculations may have rounding errors
   - **Mitigation**: Use epsilon-based comparisons for cost assertions

4. **Missing test data**: Real-world API responses may have unexpected formats
   - **Mitigation**: Test with representative sample data from actual providers

## Schedule

### Estimated Effort
- Test specification writing: 2 hours (completed in this task)
- Test implementation: 4 hours
- Test execution & debugging: 2 hours
- Documentation: 1 hour

**Total: ~9 hours**

### Phases
1. **Phase 1** (Completed): Scope definition, test plan creation
2. **Phase 2** (Current): Test case specification
3. **Phase 3** (Next): Test implementation
4. **Phase 4** (Final): Execution, reporting, documentation

## Test Coverage Areas

### 1. Message-Level Token Tracking
- `finishMessage()` correctly stores token values
- Null/undefined token values handled gracefully
- Token values persist correctly in database

### 2. Event Emission
- `step-finish` events include token data
- Token data structure matches expected schema
- Events emitted at correct lifecycle points

### 3. Data Retrieval
- `loadMessages()` returns messages with token data
- Token values correctly deserialized from database
- Historical token data preserved across sessions

### 4. Edge Cases
- Zero tokens (empty responses)
- Very large token counts (multi-million tokens)
- Missing cost information (null cost)
- Cache tokens (cacheRead, cacheWrite)
- Concurrent message updates

## Success Metrics

1. **Test Pass Rate**: 100% of test cases pass
2. **Code Coverage**: ≥ 80% for token tracking code
3. **Defect Density**: 0 critical/high bugs
4. **Execution Performance**: Test suite completes in < 5 seconds
5. **Maintainability**: Tests are readable and well-documented
