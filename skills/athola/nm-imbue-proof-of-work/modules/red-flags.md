# Red Flags - Common Violations

Thought patterns that indicate you're about to violate proof-of-work discipline.

## The "Should Work" Family

### "This should work"
**Problem:** "Should" = untested assumption

**Example:**
> "I've configured cclsp in your .mcp.json. It should work after restart."

**Reality Check:**
- Did you TEST that cclsp starts?
- Did you VERIFY it connects to language servers?
- Did you CONFIRM LSP tools become available?

**Fix:**
```markdown
Let me verify this configuration works:

[Evidence E1] Testing cclsp startup:
$ CCLSP_CONFIG_PATH=config.json npx cclsp@latest
Error: <actual error message>

Result: FAIL - Discovered issue - config path not recognized
```

---

### "Just restart and it will work"
**Problem:** Restart = magic wand thinking

**Example:**
> "Everything is configured. Just restart Claude Code and LSP will be available."

**Reality Check:**
- Did you VERIFY the issue is reload-related?
- Did you TEST a restart in a clean session?
- Did you CHECK for persistent blockers?

**Fix:**
```markdown
Let me verify a restart actually resolves this:

[E1] Current session: LSP tools unavailable
[E2] Exit and restart Claude Code
[E3] New session: Check `ps aux | grep cclsp`
Result: FAIL - cclsp still not running

Conclusion: Restart does NOT fix this. Root cause is [explain actual issue]
```

---

### "This looks correct"
**Problem:** Visual inspection ≠ functional validation

**Example:**
> "Your .cclsp.json looks correct. The syntax is valid."

**Reality Check:**
- Does "looks correct" mean it PARSES correctly?
- Does it mean it LOADS correctly?
- Does it mean it WORKS correctly?

**Fix:**
```markdown
Validating configuration:

[E1] Syntax check:
$ cat .cclsp.json | jq '.'
Result: PASS - Valid JSON

[E2] Load test:
$ CCLSP_CONFIG_PATH=./.cclsp.json npx cclsp@latest &
Result: PARTIAL - Loads but language server initialization timeout

[E3] Functional test:
$ # Try to use LSP
Result: FAIL - Tools not available

Conclusion: Syntax valid but language servers not connecting properly.
```

---

## The "Installation" Family

### "X is installed"
**Problem:** Installed ≠ functional

**Example:**
> "I see pylsp is installed at `/usr/local/bin/pylsp`."

**Reality Check:**
- Is it EXECUTABLE?
- Does it RESPOND correctly?
- Is it the right VERSION?

**Fix:**
```markdown
Verifying pylsp installation:

[E1] Binary exists:
$ ls -la /usr/local/bin/pylsp
Result: PASS - -rwxr-xr-x (executable)

[E2] Responds to queries:
$ pylsp --help
Result: PASS - Shows help text

[E3] Version check:
$ pylsp --version
Result: PASS - v1.9.0 (compatible)

[E4] Smoke test:
$ echo 'print("test")' | pylsp stdin
Result: PASS - No errors

Conclusion: pylsp is installed AND functional.
```

---

### "Dependencies are satisfied"
**Problem:** Requirements.txt ≠ runtime reality

**Example:**
> "All dependencies in package.json are installed."

**Reality Check:**
- Did you check PEER dependencies?
- Are versions COMPATIBLE?
- Are there PLATFORM-specific issues?

**Fix:**
```markdown
Dependency validation:

[E1] Direct dependencies:
$ npm list --depth=0
Result: PASS - All present

[E2] Peer dependencies:
$ npm list --depth=1 | grep UNMET
Result: PARTIAL - typescript@4 required but typescript@5 installed

[E3] Version compatibility:
$ npx check-peer-deps
Result: FAIL - 2 peer dependency mismatches

Conclusion: Dependencies installed but version conflicts exist.
```

---

## The "Configuration" Family

### "Environment variable is set"
**Problem:** Set in shell ≠ set in process

**Example:**
> "ENABLE_LSP_TOOL is set to 1 in your .bashrc."

**Reality Check:**
- Is it set in CURRENT shell?
- Will it be set in CLAUDE's process?
- Is it exported (not just local)?

**Fix:**
```markdown
Environment variable validation:

[E1] In .bashrc:
$ grep ENABLE_LSP_TOOL ~/.bashrc
Result: PASS - export ENABLE_LSP_TOOL=1

[E2] In current shell:
$ echo $ENABLE_LSP_TOOL
Result: PASS - 1

[E3] In child process:
$ bash -c 'echo $ENABLE_LSP_TOOL'
Result: PASS - 1 (properly exported)

[E4] In Claude Code process:
$ # Check if Claude sees it
Result: PARTIAL - Cannot directly verify, need to check logs

Conclusion: Set correctly in shell, assumption that Claude inherits it.
```

---

### "Config file is valid"
**Problem:** Valid syntax ≠ correct semantics

**Example:**
> "Your .cclsp.json is valid JSON."

**Reality Check:**
- Is SCHEMA valid (structure matches expectations)?
- Are PATHS correct (files actually exist)?
- Are COMMANDS correct (binaries are in PATH)?

**Fix:**
```markdown
Configuration validation:

[E1] JSON syntax:
$ jq '.' .cclsp.json
Result: PASS - Valid JSON

[E2] Schema validation:
$ # Check structure matches cclsp expectations
Result: PASS - Has required "servers" array

[E3] Path validation:
$ # For each server.command, check binary exists
$ which pylsp
Result: PASS - /usr/local/bin/pylsp
$ which typescript-language-server
Result: PASS - /usr/local/bin/typescript-language-server

[E4] Command validation:
$ pylsp --help && typescript-language-server --version
Result: PASS - Both respond correctly

Conclusion: Config is valid AND all paths are functional.
```

---

## The "Research" Family

### "According to the docs..."
**Problem:** Docs ≠ current version reality

**Example:**
> "According to the cclsp documentation, this should expose LSP tools."

**Reality Check:**
- Which VERSION are the docs for?
- Is there a CHANGELOG with breaking changes?
- Are there KNOWN ISSUES in current version?

**Fix:**
```markdown
Documentation verification:

[E1] Docs state:
"LSP tools available in Claude Code 2.0.74+"
Source: cclsp README.md

[E2] Version check:
$ claude --version
Result: 2.0.76

[E3] Known issues research:
$ <web search: "claude code 2.0.76 LSP issues">
Result: FAIL - Issue #14803 - LSP broken in 2.0.69-2.0.76

[E4] Changelog review:
Source: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
Result: PARTIAL - No fix mentioned in 2.0.76

Conclusion: Docs correct but current version has regression bug.
```

---

### "This is the recommended approach"
**Problem:** Recommended ≠ working in your specific case

**Example:**
> "The recommended approach is to use cclsp MCP server."

**Reality Check:**
- Recommended by WHOM?
- In what CONTEXT (version, OS, use case)?
- Did you TEST it in THIS environment?

**Fix:**
```markdown
Approach validation:

[E1] Recommendation source:
Source: cclsp GitHub README (updated 2024-12-15)
Context: General recommendation for Claude Code

[E2] Environment compatibility:
User's environment:
- Claude Code 2.0.76
- Ubuntu 22.04
- Python 3.12

[E3] Testing in user's environment:
$ CCLSP_CONFIG_PATH=config.json npx cclsp@latest
Result: PASS - Starts successfully

[E4] Integration test:
$ # Check if Claude Code picks it up
Result: FAIL - MCP server runs but tools not exposed (version bug)

Conclusion: Recommended approach is sound but blocked by bug #14803.
```

---

## The "Completion" Family

### "I've finished implementing X"
**Problem:** Code written ≠ code working

**Example:**
> "I've implemented the authentication feature."

**Reality Check:**
- Does it COMPILE/run?
- Does it pass TESTS?
- Does it meet ACCEPTANCE CRITERIA?

**Fix:**
```markdown
Completion validation:

[E1] Code compiles:
$ npm run build
Result: PASS - 0 errors

[E2] Tests pass:
$ npm test
Result: PASS - 24/24 passing

[E3] Acceptance criteria:
- User can register: [E2] test_user_registration PASS
- User can login: [E2] test_user_login PASS
- Passwords hashed: [E3] DB shows bcrypt hash PASS
- Session persists: [E4] Manual test PASS

Status: COMPLETE - All criteria met
```

---

### "The setup is complete"
**Problem:** Steps followed ≠ working system

**Example:**
> "LSP setup is complete. You're ready to use it."

**Reality Check:**
- Did you RUN end-to-end test?
- Did you VERIFY each component?
- Are there any BLOCKERS?

**Fix:**
```markdown
Setup validation:

[E1] Component installation:
- pylsp: PASS - Installed and functional
- cclsp: PASS - Installed and functional
- MCP config: PASS - Config file valid

[E2] Integration test:
- cclsp starts: PASS - Process running
- Language servers connect: PARTIAL - Timeout errors
- LSP tools available: FAIL - Not exposed in Claude

[E3] Blocker identification:
- Issue #14803: LSP broken in 2.0.76

Status: BLOCKED - Setup complete but unusable due to upstream bug
Next steps: Downgrade to 2.0.67 OR wait for fix
```

---

## Self-Monitoring Questions

**Before ANY completion claim, ask yourself:**

1. **"Did I run the actual command?"**
   - Not "it should work if you run X"
   - But "I ran X and here's the output"

2. **"Did I test in the target environment?"**
   - Not "works on my machine"
   - But "tested in user's Ubuntu 22.04 + Claude 2.0.76"

3. **"Did I research known issues?"**
   - Not "according to docs"
   - But "docs say X, BUT issue #123 shows Y in this version"

4. **"Can the user reproduce my validation?"**
   - Not "I verified it"
   - But "run these commands and you'll see [expected output]"

5. **"Am I making assumptions?"**
   - Not "restart should fix it"
   - But "tested restart, here's the before/after evidence"

6. **"Would I accept this from a coworker?"**
   - Not "I think this will work"
   - But "I've proven this works, here's the evidence"

---

## Recovery from Violations

**If you catch yourself violating proof-of-work:**

1. **STOP immediately** - Don't send the completion claim
2. **Run the validation** - Actually test what you were assuming
3. **Capture evidence** - Document what you find
4. **Update your claim** - Replace assumption with proof

**Example recovery:**

**About to send (BAD):**
> "LSP is configured. Restart Claude and it will work."

**After validation (GOOD):**
> "I was about to claim LSP is ready, but let me verify first...
>
> [Testing reveals bug #14803]
>
> LSP is configured correctly, but blocked by known bug in Claude 2.0.76.
> Evidence: [E1, E2, E3]
> Workaround: Downgrade to 2.0.67"

---

## The "Documentation Exception" Family

### "Skills are just documentation"
**Problem:** Markdown files can still have testable structure and behavior

**Example:**
> "I created the rigorous-reasoning skill. It's just markdown files, no code to test."

**Reality Check:**
- Does the skill file EXIST at the expected path?
- Does it contain the REQUIRED sections (frontmatter, TodoWrite items)?
- Does it reference MODULES that must also exist?
- Does the session hook INTEGRATE with it correctly?

**Fix:**
```markdown
Skills ARE testable. Write tests that verify:

[E1] Skill existence:
$ pytest test_rigorous_reasoning.py::test_skill_exists
Result: PASS - SKILL.md found at expected path

[E2] Required sections:
$ pytest test_rigorous_reasoning.py::test_skill_has_priority_signals_section
Result: PASS - "## Priority Signals" found in content

[E3] Module integration:
$ pytest test_rigorous_reasoning.py::TestAllModulesExist
Result: PASS - All 7 modules exist and have >50 lines

[E4] Hook integration:
$ bash session-start.sh | grep "rigorous-reasoning"
Result: PASS - Quick reference included
```

---

### "It's just configuration"
**Problem:** Config files have structure that can break

**Example:**
> "I updated the hook script. It's just shell, the changes are obvious."

**Reality Check:**
- Does the hook produce VALID JSON?
- Does it include the NEW content?
- Does it handle EDGE CASES (no jq, special characters)?

**Fix:**
```markdown
Config changes need validation:

[E1] JSON validity:
$ bash session-start.sh | jq '.' >/dev/null && echo VALID
Result: PASS - Valid JSON

[E2] Content included:
$ bash session-start.sh | jq -r '.hookSpecificOutput.additionalContext' | grep -c "new-section"
Result: PASS - 1 match found

[E3] Edge case:
$ PATH=/bin:/usr/bin bash session-start.sh 2>&1 | grep -v WARN | jq '.'
Result: PASS - Works without jq in PATH
```

---

### "The user wanted it fast"
**Problem:** Speed doesn't override quality gates

**Example:**
> "I shipped the feature quickly since the user seemed to want it done."

**Reality Check:**
- Did the user ASK you to skip tests?
- Is "fast" actually faster when you have to FIX bugs later?
- Would a coworker accept this excuse?

**Recovery:**
```markdown
Speed is not an excuse:

1. Writing tests first often REVEALS design issues early
2. Retrofitting tests takes LONGER than TDD
3. Bugs found later cost MORE than bugs prevented

The Iron Law is non-negotiable regardless of perceived urgency.
```

---

## The "Cargo Cult" Family

### "The AI suggested this approach"
**Problem:** AI confidence =/= correctness

**Example:**
> "Claude suggested using a factory pattern here, so I implemented it."

**Reality Check:**
- Did you understand WHY the pattern was suggested?
- Did you consider SIMPLER alternatives?
- Can you explain when this pattern would be WRONG?

**Fix:**
```markdown
AI suggestion validation:

[E1] Understanding check:
Q: Why factory pattern here?
A: [Must be able to explain, not just "AI said so"]

[E2] Alternatives considered:
- Simple function: Would this work? [Yes/No + why]
- Direct construction: Would this work? [Yes/No + why]

[E3] Trade-off awareness:
- Factory adds indirection - is that beneficial here?
- Factory adds abstraction - do we have 3+ implementations?

Conclusion: [Use pattern / Use simpler approach] because [reason I understand]
```

---

### "This is how [big company] does it"
**Problem:** Different constraints =/= transferable solution

**Example:**
> "Netflix uses microservices, so we should too."

**Reality Check:**
- Does your scale match theirs?
- Do you have their team size/expertise?
- Are you solving the same problems?

**Fix:**
```markdown
Context validation:

[E1] Scale comparison:
- Netflix: 200M+ users, 1000s engineers
- Our project: [actual scale]

[E2] Problem match:
- Netflix problem: Independent team deployment at scale
- Our problem: [actual problem]

[E3] Constraint comparison:
- Netflix: Can afford complexity overhead
- Us: [actual constraints]

Conclusion: [Appropriate / Not appropriate] because [specific reason]
```

---

### "It's a best practice"
**Problem:** "Best" without context is meaningless

**Example:**
> "Added error boundaries because they're a React best practice."

**Reality Check:**
- Best for WHAT goal?
- Recommended by WHOM?
- In WHAT context?

**Fix:**
```markdown
Best practice validation:

[E1] Goal clarification:
- What problem does this solve? [specific answer]
- Do we HAVE that problem? [yes/no with evidence]

[E2] Source verification:
- Who recommends this? [specific source]
- What context? [their assumptions]

[E3] Context match:
- Their context: [describe]
- Our context: [describe]
- Match: [yes/no]

Conclusion: [Apply / Don't apply] because [understood reason]
```

---

### "Just copy this snippet"
**Problem:** Copy-paste without understanding = technical debt

**Example:**
> "Found this regex on Stack Overflow, it handles the edge cases."

**Reality Check:**
- Do you know what EACH part does?
- Can you MODIFY it if requirements change?
- Do you know when it will FAIL?

**Fix:**
```markdown
Snippet validation:

[E1] Understanding test:
$ # Explain what each part of this regex does:
/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/

- ^[a-zA-Z0-9._%+-]+ : [my explanation]
- @ : [my explanation]
- [a-zA-Z0-9.-]+ : [my explanation]
- \.[a-zA-Z]{2,}$ : [my explanation]

[E2] Modification test:
Q: How would you add support for + addressing?
A: [must be able to answer without searching]

[E3] Failure mode test:
Q: When would this regex incorrectly reject valid emails?
A: [must know limitations]

Conclusion: [Use / Don't use] - I [do / don't] understand it
```

---

### "Make it production-ready"
**Problem:** "Production-ready" is not a specification

**Example:**
> "I made it production-ready by adding logging and error handling."

**Reality Check:**
- What SPECIFIC requirements did you add?
- Who DEFINED "production-ready"?
- How did you VERIFY readiness?

**Fix:**
```markdown
Production readiness validation:

[E1] Requirements definition:
- [ ] Error handling: [specific requirement]
- [ ] Logging: [specific requirement]
- [ ] Monitoring: [specific requirement]
- [ ] Performance: [specific requirement]
- [ ] Security: [specific requirement]

[E2] Verification evidence:
- Error handling: [E-test1] unit tests PASS
- Logging: [E-test2] log output verified
- etc.

[E3] Missing requirements:
- Load testing: NOT DONE (deferred to [issue])
- Security audit: NOT DONE (deferred to [issue])

Conclusion: "Production-ready" for [defined scope], NOT for [missing items]
```

---

## The Ultimate Red Flag

**Thought:** "I don't need to test this, it's obvious it will work."

**Reality:** Nothing is obvious. Everything must be proven.

**Recovery:** Test it anyway. Evidence beats intuition every time.

---

## Cargo Cult Summary

**The fundamental cargo cult error:** Using code/patterns you can't explain.

**Test:** If you can't teach it to someone else, you don't understand it.

**Rule:** If you don't understand it, don't ship it.

See [anti-cargo-cult.md](anti-cargo-cult.md) for the complete understanding verification protocol.
