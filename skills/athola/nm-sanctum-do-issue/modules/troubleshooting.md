# Troubleshooting

Common issues and solutions when using do-issue.

## Error: Issue Not Found

```bash
Error: Issue #42 not found
Verify:
  - Issue exists in current repository
  - You have access to the repository
  - Issue number is correct
```

## Error: Subagent Failure

```bash
Error: Subagent failed on Issue #42 Task 2
Cause: Test failures after implementation

Options:
  1. Dispatch fix subagent (recommended)
  2. Skip task and continue
  3. Abort workflow

[Selecting option 1...]
Dispatching fix subagent...
```

## Warning: Merge Conflicts

```bash
Warning: Parallel changes created conflicts
Files: src/auth/middleware.ts

Resolution:
  1. Pausing parallel execution
  2. Resolving conflicts via dedicated subagent
  3. Resuming after resolution
```

## Subagent Not Following Requirements

```bash
Problem: Subagent implemented feature differently than specified
Solution: Re-dispatch with more explicit prompt including:
  - Exact acceptance criteria from issue
  - Code examples if provided
  - Links to related files
```

## Too Many Parallel Conflicts

```bash
Problem: Multiple subagents modifying same files
Solution: Use --no-parallel or manually group tasks to avoid overlap
```

## Review Taking Too Long

```bash
Problem: Code review subagent taking excessive time
Solution: Split large batches into smaller groups
```

## Subagent Hangs (Remote Control / Headless)

When running do-issue through `/remote-control` or headless
SDK sessions, subagents can hang indefinitely with no
recovery path. This is a known upstream bug
([#28482](https://github.com/anthropics/claude-code/issues/28482)).

**Symptoms:**
- Task status shows "In progress" forever
- No output, no tool calls, no error from the subagent
- Remote control web UI shows "philosophizing/tinkering"
  indefinitely
- New prompts are queued but never processed

**Recovery:**
1. If you have local terminal access, press `Esc` to
   interrupt the hung subagent
2. If headless: `kill -SIGINT <claude_pid>` to interrupt
3. Start a fresh session rather than trying to resume

**Prevention:**
- Run subagent-heavy workflows **locally**, not via
  remote-control (Esc is the only recovery mechanism)
- Use `run_in_background: true` on Agent calls so the
  parent can continue processing if a subagent stalls
- Limit concurrent subagents to reduce hang probability
- Monitor from a local terminal even when using remote
  control

**Related issues:**
- [#28482](https://github.com/anthropics/claude-code/issues/28482) - Agent hang, no headless recovery
- [#33232](https://github.com/anthropics/claude-code/issues/33232) - Remote-control WebSocket instability
- [#13240](https://github.com/anthropics/claude-code/issues/13240) - Master freeze/hang bug

## Best Practices

### Before Running

1. validate clean working directory (`git status` shows no changes)
2. Pull latest from remote
3. Verify GitHub CLI is authenticated (`gh auth status`)
4. Review issues briefly to confirm they're ready for implementation

### During Execution

1. Monitor subagent progress via TodoWrite
2. Don't manually edit files while subagents are working
3. Let code reviews complete before proceeding
4. Address Critical issues immediately

### After Completion

1. Review final changes before merging
2. Verify all tests pass
3. Update issue comments with implementation notes
4. Create PR if working on branch
