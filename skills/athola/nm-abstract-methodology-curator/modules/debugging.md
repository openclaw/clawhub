# Debugging Masters

Expert frameworks for systematic troubleshooting, root cause analysis, and efficient bug resolution.

## Masters Overview

| Expert | Key Contribution | Best For |
|--------|-----------------|----------|
| Andreas Zeller | Scientific Debugging | Systematic hypothesis testing |
| David Agans | Nine Rules of Debugging | Universal debugging principles |
| Diomidis Spinellis | Effective Debugging | Comprehensive toolkit |
| Rob Miller | Debugging by Asking | Root cause questioning |
| John Regehr | Compiler/Systems Debugging | Low-level issues |

## Detailed Frameworks

### Zeller's Scientific Debugging

**Source**: Andreas Zeller - "Why Programs Fail" (2009)

**Core Idea**: Apply scientific method to debugging—hypothesis, experiment, conclusion.

**The Scientific Debugging Process**:
```
1. OBSERVE failure
2. HYPOTHESIZE cause (be specific!)
3. PREDICT behavior if hypothesis true
4. EXPERIMENT to test prediction
5. CONCLUDE: confirmed or refuted
6. REPEAT with new hypothesis
```

**Key Principle**: Never change code to "see if it fixes it." That's guessing, not debugging.

**Hypothesis Quality**:
```
BAD:  "Something's wrong with the database"
GOOD: "The query times out because it scans all rows without index"
```

**Delta Debugging** (Zeller's technique):
- Minimize failing input
- Find smallest change that triggers bug
- Isolate exactly what causes failure

**Use When**: Complex bugs, intermittent failures, need systematic approach.

---

### Agans' Nine Rules

**Source**: David Agans - "Debugging: The 9 Indispensable Rules" (2002)

**Core Idea**: Universal rules that apply to any debugging scenario.

**The Nine Rules**:

| # | Rule | Application |
|---|------|-------------|
| 1 | **Understand the System** | Read docs, trace data flow before assuming |
| 2 | **Make It Fail** | Reproduce reliably before investigating |
| 3 | **Quit Thinking and Look** | Actually read error messages, logs, state |
| 4 | **Divide and Conquer** | Binary search to isolate |
| 5 | **Change One Thing at a Time** | Controlled experiments only |
| 6 | **Keep an Audit Trail** | Log what you tried and results |
| 7 | **Check the Plug** | Verify assumptions, environment, obvious things |
| 8 | **Get a Fresh View** | Rubber duck, ask colleague, sleep on it |
| 9 | **If You Didn't Fix It, It Ain't Fixed** | Verify root cause, not just symptoms |

**Most Violated Rules**:
- #3: Jumping to hypotheses without reading the actual error
- #5: Changing multiple things hoping something works
- #9: Seeing issue disappear and assuming it's fixed

**Use When**: Any debugging situation—these are universal.

---

### Spinellis' Debugging Strategies

**Source**: Diomidis Spinellis - "Effective Debugging" (2016)

**Core Idea**: Comprehensive toolkit organized by debugging phase.

**Strategy Categories**:

**High-Level Strategies**:
| Strategy | When to Use |
|----------|-------------|
| Reproduce consistently | First step, always |
| Simplify input | Large inputs, complex state |
| Minimize code | Isolate to smallest failing example |
| Add instrumentation | Need visibility into behavior |
| Review recent changes | "It was working yesterday" |

**Technical Strategies**:
| Strategy | Application |
|----------|-------------|
| Printf debugging | Quick visibility, any environment |
| Debugger stepping | Complex control flow |
| Core dump analysis | Crashes, post-mortem |
| Profiling | Performance issues |
| Tracing | System call, network issues |

**Process Strategies**:
| Strategy | When to Use |
|----------|-------------|
| Pair debugging | Stuck for >30 minutes |
| Take a break | Tunnel vision, frustration |
| Explain to rubber duck | Can't articulate problem |
| Search error message | May be known issue |

**Use When**: Need specific technique for specific problem type.

---

### Miller's Debugging Questions

**Source**: Rob Miller (MIT) - Debugging lectures

**Core Idea**: Systematic questioning reveals root cause.

**The Question Ladder**:

1. **What did you expect to happen?**
2. **What actually happened?**
3. **What's the difference?**
4. **When did it last work?**
5. **What changed since then?**
6. **Where exactly does behavior diverge from expectation?**

**Localization Questions**:
- At what point does the state become incorrect?
- What is the last known good state?
- What is the first known bad state?

**Use When**: Starting any debugging session, structuring investigation.

---

### Regehr's Low-Level Debugging

**Source**: John Regehr - Embedded Systems & Compiler Expert

**Core Idea**: Systems-level bugs need systems-level thinking.

**Principles**:
- **Trust nothing**: Verify compiler output, hardware state
- **Reduce**: Minimize to smallest reproducer
- **Isolation**: Test components independently
- **Invariants**: Assert what must be true

**Common Systems Bug Categories**:
| Category | Symptoms | Approach |
|----------|----------|----------|
| Memory corruption | Crashes, weird values | Valgrind, ASan |
| Race conditions | Intermittent, timing-dependent | Thread sanitizer, logging |
| Resource leaks | Slow degradation | Monitor, profiling |
| Undefined behavior | "Works on my machine" | UBSan, static analysis |

**Use When**: Low-level, systems, or intermittent bugs.

## Selection Matrix

| Bug Type | Primary Framework | Supporting |
|----------|------------------|------------|
| Any bug (start here) | Agans' 9 Rules | Miller Questions |
| Complex/subtle bugs | Zeller Scientific | Agans #5, #6 |
| "It was working" | Spinellis Review Changes | Agans #1 |
| Intermittent failures | Zeller Delta Debug | Regehr |
| Performance issues | Spinellis Profiling | Agans #4 |
| Unknown territory | Agans #1, #7 | Miller Questions |

## Debugging Workflow Template

Blended from all frameworks:

```markdown
## Bug: [Brief description]

### 1. Understand & Reproduce (Agans #1, #2)
- System understanding: [What should happen]
- Reproduction steps:
  1. [Step]
  2. [Step]
- Reproduction rate: [Always/Sometimes/Rare]

### 2. Observe (Agans #3, Miller)
- Expected: [What should happen]
- Actual: [What happens]
- Difference: [Gap]
- Last working: [When/version]

### 3. Hypothesize (Zeller)
| # | Hypothesis | Prediction | Test | Result |
|---|------------|------------|------|--------|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

### 4. Isolate (Agans #4, #5)
- Binary search log:
  - [✓] Works at commit abc123
  - [✗] Fails at commit def456
  - Narrowed to: [specific change]

### 5. Fix & Verify (Agans #9)
- Root cause: [Actual cause]
- Fix: [What changed]
- Verification: [How confirmed]
- Regression test added: [Yes/No]
```

## Anti-Patterns to Avoid

- **Shotgun debugging**: Changing random things hoping to fix it
- **Assumption debugging**: Not verifying basic assumptions (Agans #7)
- **Tunnel vision**: Fixating on one hypothesis without testing others
- **History blindness**: Not checking what recently changed
- **Solo heroics**: Not asking for help when stuck (Agans #8)
- **Premature celebration**: Assuming it's fixed without proof (Agans #9)
