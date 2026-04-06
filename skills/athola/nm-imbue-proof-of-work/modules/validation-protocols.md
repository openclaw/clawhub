# Validation Protocols

Detailed testing protocols for common completion scenarios.

## Protocol Types

### 1. Configuration Validation

**Use when:** Setting up tools, environments, services

**Steps:**
1. **Verify prerequisites exist**
   ```bash
   # Example: Check dependencies
   which pylsp typescript-language-server
   python --version
   npm --version
   ```

2. **Test configuration loads**
   ```bash
   # Example: Validate config file
   cat .cclsp.json | jq '.'  # Validates JSON syntax
   ```

3. **Attempt service start**
   ```bash
   # Example: Start service in test mode
   CCLSP_CONFIG_PATH=./config.json npx cclsp@latest &
   sleep 2
   ps aux | grep cclsp
   ```

4. **Verify service responds**
   ```bash
   # Example: Health check or simple query
   curl localhost:8080/health
   # OR check logs for successful initialization
   ```

**Acceptance Criteria:**
- [ ] All prerequisites found in $PATH
- [ ] Configuration file parses without errors
- [ ] Service starts without fatal errors
- [ ] Service responds to basic queries
- [ ] Logs show expected initialization messages

---

### 2. Installation Validation

**Use when:** Installing packages, tools, binaries

**Steps:**
1. **Verify installation command succeeds**
   ```bash
   npm install -g cclsp
   echo $?  # Must be 0
   ```

2. **Check binary is in PATH**
   ```bash
   which cclsp
   # Must return a path, not "not found"
   ```

3. **Test version/help output**
   ```bash
   cclsp --version  # OR --help
   # Must return valid output, not command not found
   ```

4. **Run smoke test**
   ```bash
   # Example: Minimal invocation
   cclsp setup --dry-run
   ```

**Acceptance Criteria:**
- [ ] Installation exits with code 0
- [ ] Binary is executable and in $PATH
- [ ] Version/help commands work
- [ ] Smoke test completes successfully

---

### 3. Integration Validation

**Use when:** Integrating multiple components (e.g., LSP + MCP + Claude)

**Steps:**
1. **Test each component in isolation**
   ```bash
   # Component A
   pylsp --help  # PASS - Works standalone

   # Component B
   npx cclsp@latest --help  # PASS - Works standalone
   ```

2. **Test pairwise integration**
   ```bash
   # A + B together
   CCLSP_CONFIG_PATH=config.json npx cclsp@latest &
   # Check if cclsp can communicate with pylsp
   ```

3. **Test full stack integration**
   ```bash
   # Start Claude Code with all components
   ENABLE_LSP_TOOL=1 claude
   # Inside Claude: test LSP tool availability
   ```

4. **Verify end-to-end flow**
   ```bash
   # User action -> through stack -> expected result
   # Example: "find definition of X" -> LSP query -> result returned
   ```

**Acceptance Criteria:**
- [ ] Each component works in isolation
- [ ] Pairwise integration succeeds
- [ ] Full stack starts without errors
- [ ] End-to-end user flow completes successfully
- [ ] Logs show proper component communication

---

### 4. Bug/Issue Research Validation

**Use when:** Recommending solutions that could have known issues

**Steps:**
1. **Check GitHub issues for project**
   ```bash
   <web search: "github {project} issues {version} {keywords}">
   # Example: "github anthropics claude-code issues 2.0.76 LSP"
   ```

2. **Search recent release notes**
   ```bash
   <web search: "{project} release notes {version} changelog">
   # Look for breaking changes, known issues
   ```

3. **Check community forums/discussions**
   ```bash
   <web search: "{project} {feature} not working {version}">
   # Reddit, HackerNews, Stack Overflow
   ```

4. **Verify version compatibility matrix**
   ```bash
   # Check docs for supported versions
   <web search: "{dependency} compatibility {version}">
   ```

**Acceptance Criteria:**
- [ ] Searched GitHub issues for known bugs
- [ ] Checked release notes for breaking changes
- [ ] Reviewed community reports of problems
- [ ] Verified version compatibility
- [ ] Documented any blockers found

---

### 5. Code/Script Validation

**Use when:** Writing or recommending code/scripts

**Steps:**
1. **Syntax check**
   ```bash
   # Python
   python -m py_compile script.py

   # Bash
   bash -n script.sh

   # JavaScript/TypeScript
   npx tsc --noEmit file.ts
   ```

2. **Linting check**
   ```bash
   # Python
   ruff check script.py

   # Bash
   shellcheck script.sh

   # JavaScript
   eslint file.js
   ```

3. **Dry-run or safe execution**
   ```bash
   # Many tools support --dry-run, --check, or --simulate
   ansible-playbook playbook.yml --check
   terraform plan  # Not apply
   ```

4. **Test with sample data**
   ```bash
   # Run script with non-production test data
   python script.py --input test_data.json
   ```

**Acceptance Criteria:**
- [ ] Code passes syntax validation
- [ ] Linter reports no critical issues
- [ ] Dry-run succeeds without errors
- [ ] Test execution produces expected output
- [ ] No destructive actions in test mode

---

### 6. Environment/Dependency Validation

**Use when:** Assuming environment state or dependencies

**Steps:**
1. **Check environment variables**
   ```bash
   echo $REQUIRED_VAR
   # Must be set and non-empty
   ```

2. **Verify file/directory existence**
   ```bash
   ls -la /expected/path/to/config
   # Must exist with correct permissions
   ```

3. **Check network connectivity** (if applicable)
   ```bash
   ping -c 1 required-service.com
   curl -I https://api.example.com/health
   ```

4. **Validate credentials/auth** (if applicable)
   ```bash
   # Test auth without side effects
   gh auth status
   aws sts get-caller-identity
   ```

**Acceptance Criteria:**
- [ ] Required env vars are set
- [ ] Expected files/dirs exist
- [ ] Network dependencies are reachable
- [ ] Authentication works
- [ ] Permissions are correct

---

## Protocol Selection Guide

| Scenario | Use Protocol |
|----------|-------------|
| Setting up LSP, MCP servers | Configuration Validation |
| Installing npm/pip packages | Installation Validation |
| Connecting Claude + LSP + MCP | Integration Validation |
| Recommending a tool/approach | Bug/Issue Research |
| Writing scripts or code | Code/Script Validation |
| Assuming system state | Environment/Dependency Validation |

## Evidence Capture Template

For each protocol step, capture:

```markdown
### [Protocol Name] - Step [N]: [Step Description]

**Command:**
```bash
<exact command run>
```

**Output:**
```
<relevant output, truncated if long>
```

**Result:** PASS / FAIL / WARNING

**Notes:**
- Any unexpected behavior
- Workarounds applied
- Decisions made
```

## Combining Protocols

**Complex scenarios often need multiple protocols:**

Example: "Set up LSP in Claude Code"

1. **Installation Validation** - Verify pylsp, cclsp installed
2. **Configuration Validation** - Test .mcp.json, .cclsp.json valid
3. **Integration Validation** - Verify Claude → cclsp → pylsp chain
4. **Bug/Issue Research** - Check for known issues in current versions
5. **Environment Validation** - Confirm ENABLE_LSP_TOOL set

**Only after ALL protocols pass can you claim "LSP is set up".**
