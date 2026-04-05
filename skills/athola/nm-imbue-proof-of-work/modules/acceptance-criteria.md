# Acceptance Criteria

Definition of Done (DoD) templates for common completion scenarios.

Based on [Agile acceptance criteria best practices](https://www.atlassian.com/agile/project-management/definition-of-done).

## Core Principles

1. **SMART Criteria:** Specific, Measurable, Achievable, Relevant, Testable
2. **Binary Outcomes:** Must be pass/fail, no "partially complete"
3. **User-Verifiable:** User can independently test each criterion
4. **Evidence-Backed:** Each criterion links to proof

## Template Format

```markdown
## Task: [Description]

### Acceptance Criteria
- [ ] [Criterion 1 - specific, testable]
- [ ] [Criterion 2 - specific, testable]
- [ ] [Criterion 3 - specific, testable]

### Test Evidence
- Criterion 1: [Evidence reference] → PASS / FAIL
- Criterion 2: [Evidence reference] → PASS / FAIL
- Criterion 3: [Evidence reference] → PASS / FAIL

### Status
- COMPLETE: All criteria passed
- PARTIAL: Some criteria passed (list blockers)
- BLOCKED: Cannot complete (explain why)

### User Verification Steps
1. [Step-by-step instructions for user to verify]
2. [Expected outcome at each step]
```

---

## Common Scenarios

### 1. Configuration Setup

```markdown
## Task: Configure LSP for Claude Code

### Acceptance Criteria
- [ ] Language servers installed and in $PATH
- [ ] MCP configuration file contains cclsp entry
- [ ] ENABLE_LSP_TOOL environment variable set to 1
- [ ] cclsp starts without errors when Claude Code launches
- [ ] LSP tools (find_definition, find_references) are callable from Claude

### Test Evidence
- Language servers: [E1] `which pylsp` returns valid path → PASS
- MCP config: [E2] `.mcp.json` contains cclsp entry → PASS
- Env var: [E3] `echo $ENABLE_LSP_TOOL` returns "1" → PASS
- cclsp starts: [E4] `ps aux | grep cclsp` shows running process → FAIL
- LSP tools available: [E5] Cannot test (blocked by E4) → BLOCKED

### Status
BLOCKED - cclsp does not start in Claude Code 2.0.76 due to bug #14803

### Known Issues
- Issue #14803: LSP plugin loading broken in versions 2.0.69-2.0.76
- Source: https://github.com/anthropics/claude-code/issues/14803

### User Verification Steps
Cannot provide verification steps - task is blocked by upstream bug.

**Workaround Options:**
1. Downgrade to Claude Code 2.0.67
2. Wait for fix in future release
```

---

### 2. Feature Implementation

```markdown
## Task: Implement user authentication

### Acceptance Criteria
- [ ] User can register with email/password
- [ ] User can log in with valid credentials
- [ ] User cannot log in with invalid credentials
- [ ] Session persists across page refreshes
- [ ] User can log out and session is cleared
- [ ] Passwords are hashed (not stored in plaintext)
- [ ] All auth endpoints have rate limiting
- [ ] Auth flow has >85% test coverage

### Test Evidence
- Registration: [E1] `curl -X POST /register` returns 201 → PASS
- Valid login: [E2] `curl -X POST /login` with correct creds → PASS
- Invalid login: [E3] `curl -X POST /login` with wrong creds returns 401 → PASS
- Session persistence: [E4] Tested in browser, session survives refresh → PASS
- Logout: [E5] Session cleared after `/logout` → PASS
- Password hashing: [E6] DB query shows bcrypt hash, not plaintext → PASS
- Rate limiting: [E7] 6th request within 1min returns 429 → PASS
- Test coverage: [E8] `pytest --cov` shows 87% for auth module → PASS

### Status
COMPLETE - All criteria passed

### User Verification Steps
1. Run test suite: `pytest tests/test_auth.py -v`
2. Expected: All tests pass (8/8)
3. Start dev server: `npm run dev`
4. Visit `/register`, create account
5. Expected: Redirected to dashboard
6. Refresh page
7. Expected: Still logged in
8. Click logout
9. Expected: Redirected to login page
```

---

### 3. Bug Fix

```markdown
## Task: Fix memory leak in connection pool

### Acceptance Criteria
- [ ] Memory leak reproduced and characterized
- [ ] Root cause identified and documented
- [ ] Fix implemented and tested
- [ ] Memory usage stable over 1000 operations
- [ ] No regression in connection pool performance
- [ ] Unit test added to prevent regression

### Test Evidence
- Leak reproduced: [E1] `valgrind` shows 4KB unreleased per connection → CONFIRMED
- Root cause: [E2] Code review shows missing `pool.release()` in error path → IDENTIFIED
- Fix implemented: [E3] Added `finally` block with `pool.release()` → DONE
- Memory stable: [E4] 1000 ops, memory growth <1% → PASS
- No regression: [E5] Benchmark shows same throughput (±2%) → PASS
- Regression test: [E6] Added `test_connection_cleanup_on_error()` → PASS

### Status
COMPLETE - All criteria passed

### User Verification Steps
1. Run regression test: `pytest tests/test_connection_pool.py::test_connection_cleanup_on_error`
2. Expected: Test passes
3. Run memory profiling: `python -m memory_profiler scripts/stress_test_pool.py`
4. Expected: Memory usage stays flat over 1000 operations
```

---

### 4. Documentation Update

```markdown
## Task: Document new API endpoint

### Acceptance Criteria
- [ ] Endpoint description includes purpose and use cases
- [ ] Request format documented with example
- [ ] Response format documented with example (success and error)
- [ ] Authentication requirements specified
- [ ] Rate limits documented
- [ ] Common error codes listed with explanations
- [ ] Code example provided in at least 2 languages
- [ ] Documentation tested by someone unfamiliar with the feature

### Test Evidence
- Description: [E1] README.md contains "## POST /api/users" section → PASS
- Request format: [E2] JSON schema and curl example provided → PASS
- Response format: [E3] Both 200 and 400 responses documented → PASS
- Auth requirements: [E4] "Requires Bearer token" documented → PASS
- Rate limits: [E5] "100 requests/hour" documented → PASS
- Error codes: [E6] Table of 400, 401, 429, 500 with explanations → PASS
- Code examples: [E7] Python and JavaScript examples provided → PASS
- Testing: [E8] Junior dev followed docs successfully → PASS

### Status
COMPLETE - All criteria passed

### User Verification Steps
1. Open `docs/API.md`
2. Find "POST /api/users" section
3. Copy the curl example
4. Run it with your API key
5. Expected: Receives documented response format
6. Try with invalid data
7. Expected: Receives documented error response
```

---

### 5. Research/Investigation

```markdown
## Task: Research best LSP setup for Claude Code

### Acceptance Criteria
- [ ] Evaluated at least 3 different LSP integration approaches
- [ ] Each approach tested in actual Claude Code environment
- [ ] Pros/cons documented for each approach
- [ ] Known issues/bugs researched for each approach
- [ ] Recommendation provided with evidence
- [ ] Reproduction steps documented for recommended approach

### Test Evidence
- Approach 1 (native LSP): [E1] Tested in 2.0.76 → FAIL (bug #14803)
- Approach 2 (cclsp MCP): [E2] Config tested, cclsp starts → PARTIAL (tools not exposed)
- Approach 3 (downgrade to 2.0.67): [E3] Research shows this version works → VIABLE
- Pros/cons: [E4] Comparison table created → DONE
- Known issues: [E5] GitHub search completed, issues documented → DONE
- Recommendation: [E6] "Downgrade to 2.0.67 until bug fixed" → PROVIDED
- Reproduction steps: [E7] Step-by-step downgrade instructions → DOCUMENTED

### Status
COMPLETE - Research concluded with recommendation

### Findings Summary
- Native LSP broken in 2.0.76 (blocker)
- cclsp MCP configured but tools unavailable (blocker)
- Downgrade to 2.0.67 is only working solution currently

### User Verification Steps
1. Follow documented downgrade steps
2. Verify LSP tools become available in 2.0.67
3. Expected: `mcp__cclsp__find_definition` and similar tools work
```

---

## Anti-Patterns (What NOT to Do)

### Vague Criteria

**Bad:**
- [ ] LSP is set up correctly

**Good:**
- [ ] `ps aux | grep cclsp` shows running process
- [ ] `echo $ENABLE_LSP_TOOL` returns "1"

### Non-Testable Criteria

**Bad:**
- [ ] Code looks good

**Good:**
- [ ] `ruff check` passes with 0 errors
- [ ] `pytest --cov` shows >85% coverage

### Assumed Rather Than Proven

**Bad:**
- Status: COMPLETE - Should work after restart

**Good:**
- Status: PARTIAL - Restart required, tested in fresh session [E9]

### Missing Evidence Links

**Bad:**
- Session persistence: PASS

**Good:**
- Session persistence: [E4] Browser test shows cookie survives refresh → PASS

---

## Completion Checklist

Before claiming "done", verify:

- [ ] Every acceptance criterion is SMART (specific, measurable, achievable, relevant, testable)
- [ ] Every criterion has linked evidence
- [ ] Evidence is reproducible (commands/steps provided)
- [ ] User can independently verify each criterion
- [ ] Any blockers are clearly documented
- [ ] Status is accurate (COMPLETE/PARTIAL/BLOCKED)
- [ ] If PARTIAL or BLOCKED, next steps are provided
