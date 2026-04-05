# Instruction Design Masters

Expert frameworks for teaching techniques, writing effective instructions, and creating behavioral change through documentation.

## Masters Overview

| Expert | Key Contribution | Best For |
|--------|-----------------|----------|
| Robert Mager | Behavioral Objectives | Measurable skill outcomes |
| Benjamin Bloom | Taxonomy of Learning | Cognitive level targeting |
| Robert Gagné | Nine Events of Instruction | Structured lesson design |
| John Sweller | Cognitive Load Theory | Reducing mental overhead |
| Ruth Clark | Evidence-Based Training | Practical instructional design |

## Detailed Frameworks

### Mager's Behavioral Objectives

**Source**: Robert Mager - "Preparing Instructional Objectives" (1962)

**Core Idea**: Objectives must specify observable behavior, conditions, and criteria.

**Key Principles**:
- **Performance**: What the learner will DO (observable verb)
- **Conditions**: Under what circumstances (tools, constraints)
- **Criterion**: How well (accuracy, speed, quality threshold)

**Formula**: "Given [conditions], the learner will [performance] to [criterion]."

**Example for Skills**:
```
BAD:  "Understand TDD methodology"
GOOD: "Given a failing test, implement minimal code to pass within 3 iterations"
```

**Use When**: Creating technique skills, defining success criteria, writing "Use when" clauses.

**Avoid When**: Teaching abstract concepts, pattern recognition, creative tasks.

---

### Bloom's Taxonomy (Revised)

**Source**: Benjamin Bloom et al., revised by Anderson & Krathwohl (2001)

**Core Idea**: Learning has hierarchical levels; target the right cognitive level.

**Levels (lowest to highest)**:
1. **Remember**: Recall facts → Reference skills, checklists
2. **Understand**: Explain concepts → Pattern skills, mental models
3. **Apply**: Use in new situations → Technique skills, workflows
4. **Analyze**: Break down, find patterns → Debugging skills, code review
5. **Evaluate**: Judge, critique → Assessment frameworks, quality gates
6. **Create**: Produce new work → Design skills, architecture guidance

**Use When**: Determining skill type, structuring progressive disclosure, setting appropriate depth.

**Skill Mapping**:
| Skill Type | Target Level | Verbs to Use |
|-----------|--------------|--------------|
| Reference | Remember | List, recall, identify |
| Pattern | Understand | Explain, compare, summarize |
| Technique | Apply/Analyze | Implement, execute, debug |

---

### Gagné's Nine Events of Instruction

**Source**: Robert Gagné - "The Conditions of Learning" (1965)

**Core Idea**: Effective instruction follows nine sequential events.

**The Nine Events**:
1. **Gain attention**: Hook with problem or scenario
2. **Inform objectives**: State what they'll learn (Use when clause)
3. **Stimulate recall**: Connect to prior knowledge
4. **Present content**: The actual instruction
5. **Provide guidance**: Examples, worked problems
6. **Elicit performance**: Practice opportunity
7. **Provide feedback**: Correct/reinforce
8. **Assess performance**: Verify learning
9. **Enhance retention**: Transfer to real contexts

**Skill Structure Mapping**:
```
SKILL.md Structure           Gagné Event
─────────────────────────────────────────
Overview/Problem statement → 1. Gain attention
"Use when" clause          → 2. Inform objectives
Related skills/prereqs     → 3. Stimulate recall
Core content               → 4. Present content
Examples                   → 5. Provide guidance
Workflows/checklists       → 6. Elicit performance
Anti-patterns/red flags    → 7. Provide feedback
Validation commands        → 8. Assess performance
Real-world scenarios       → 9. Enhance retention
```

**Use When**: Designing complete skill structure, ensuring nothing essential is missing.

---

### Cognitive Load Theory

**Source**: John Sweller - "Cognitive Load Theory" (1988)

**Core Idea**: Working memory is limited; reduce unnecessary load.

**Three Types of Load**:
- **Intrinsic**: Complexity inherent to the material (can't reduce)
- **Extraneous**: Poor presentation adding confusion (ELIMINATE)
- **Germane**: Effort building mental models (MAXIMIZE)

**Techniques for Skills**:
| Principle | Application |
|-----------|-------------|
| Chunking | Progressive disclosure, modular files |
| Worked examples | Complete code samples, not pseudocode |
| Split attention | Keep related info together (no "see also" mid-flow) |
| Redundancy | Don't repeat same info in text AND diagram |
| Expertise reversal | Advanced users need less scaffolding |

**Use When**: Optimizing token efficiency, structuring modules, deciding what to cut.

---

### Clark's Evidence-Based Training

**Source**: Ruth Clark - "Evidence-Based Training Methods" (2019)

**Core Idea**: Use research-proven methods, not intuition.

**Key Findings**:
- **Examples beat descriptions**: Show, don't tell
- **Practice with feedback**: Interactive > passive reading
- **Spaced learning**: Break into digestible chunks
- **Relevant context**: Real scenarios > abstract theory

**Anti-patterns** (feel effective but aren't):
- Long prose explanations
- Comprehensive coverage without practice
- Learning styles myths (visual/auditory)
- Information dumps

**Use When**: Reviewing skills for effectiveness, cutting unnecessary content.

## Selection Matrix

| Your Goal | Primary Framework | Supporting |
|-----------|------------------|------------|
| Define clear outcomes | Mager | Bloom |
| Structure complete skill | Gagné | Cognitive Load |
| Reduce skill complexity | Cognitive Load | Clark |
| Choose skill type | Bloom | Mager |
| Validate effectiveness | Clark | Gagné |

## Blending Example

Creating a debugging skill:
1. **Bloom**: Target "Analyze" level (break down, identify patterns)
2. **Mager**: "Given error output, identify root cause within 3 hypotheses"
3. **Cognitive Load**: Use worked examples, progressive modules
4. **Gagné**: Structure with attention hook → examples → practice workflow

## Anti-Patterns to Avoid

- **Covering everything**: Cognitive overload, low retention
- **Vague objectives**: "Understand debugging" (not measurable)
- **Missing practice**: All theory, no application
- **Wrong level**: Teaching "remember" when "apply" is needed
