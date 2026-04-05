# Quality Metrics Framework

Based on official Claude Developer Platform skill authoring best practices.

## Scoring Categories

### Structure Compliance (0-100)
- **YAML frontmatter**: Completeness and validity of metadata
  - `name`: ≤64 chars, lowercase/numbers/hyphens only, no XML tags, no reserved words
  - `description`: Non-empty, ≤1024 chars, no XML tags
- **Progressive disclosure**: SKILL.md body under 500 lines, links to detailed modules
- **Reference depth**: All references one level deep from SKILL.md (no nested chains)
- **Section organization**: Logical flow and clarity of content organization
- **File naming**: Gerund form preferred (`processing-pdfs`), descriptive names

### Content Quality (0-100)
- **Quick Start concreteness**: Actual commands, not abstract descriptions (Run `pytest --cov` vs "Configure pytest")
- **Conciseness**: Only adds context Claude doesn't already have
- **Description effectiveness**: Third person, includes WHAT it does AND WHEN to use it
- **Clarity**: Explanations are clear and easy to understand
- **Practical examples**: Input/output pairs for pattern demonstration
- **Verification steps**: Post-example validation commands (Run `pytest -v` to verify)
- **Voice consistency**: No second-person ("your needs" → "project requirements")
- **Consistent terminology**: Same terms used throughout (not "field/box/element")

### Token Efficiency (0-100)
- **Content density**: Information presented without unnecessary explanation
- **Default assumption**: Treats Claude as already smart (no basic explanations)
- **Progressive loading**: Essential content loads first, details on-demand
- **Navigation aids (CRITICAL)**: Long modules (>100 lines) MUST have TOC after frontmatter for agentic search efficiency
- **Context optimization**: Efficient use of shared context window

### Activation Reliability (0-100)
- **Description specificity (CRITICAL)**: Minimum 5 specific trigger phrases for marketplace discoverability
- **Trigger clarity**: Clear when skill should activate vs alternatives
- **Context indicators**: Strong contextual cues for when to use
- **Discovery patterns**: Easy to find and categorize

### Degrees of Freedom Alignment (0-100)
- **Task-specificity match**: Instructions match task fragility
  - High freedom for context-dependent tasks (multiple valid approaches)
  - Medium freedom for preferred patterns with variation
  - Low freedom for fragile, consistency-critical operations
- **Workflow structure**: Complex tasks have checklists Claude can track
- **Feedback loops**: Validation steps before proceeding

### Tool Integration (0-100)
- **Script quality**: Solve errors explicitly, don't punt to Claude
- **Configuration constants**: Documented (no magic numbers)
- **Execute vs read clarity**: Clear whether scripts should be run or read
- **Verification steps**: Post-code-example validation commands for all patterns
- **MCP tool references**: Fully qualified names (`Server:tool_name`)
- **Verifiable outputs**: Plan-validate-execute pattern for complex operations

### Documentation Completeness (0-100)
- **Examples**: Input/output pairs demonstrating patterns
- **Troubleshooting**: Common issues and solutions documented
- **Reference materials**: Complete API and usage references
- **Time-sensitivity avoidance**: No date-dependent instructions (use "old patterns" sections)

### Persuasion Effectiveness (0-100)
- **Authority usage**: Imperative language for critical rules
- **Commitment patterns**: Explicit declarations required
- **Social proof**: Universal norms documented
- **Model calibration**: Language appropriate for target models

### Anti-Rationalization Coverage (0-100)
- **Loophole closures**: Specific exceptions listed
- **Rationalization table**: Common excuses with counters
- **Red flags list**: Self-checking triggers documented
- **Foundational principles**: "Spirit vs letter" addressed early

### Discovery Optimization (0-100)
- **Description specificity**: Key terms for discovery (5+ trigger phrases minimum)
- **Third person voice (CRITICAL)**: Consistent point of view - NO "your"/"you", use "project"/"developers"
- **Trigger clarity**: Clear activation conditions
- **Distinctiveness**: Differentiates from similar skills

## Scoring Levels

### Excellent (90-100)
- Meets all criteria with exceptional quality
- Serves as reference implementation
- Includes detailed tooling and examples
- Demonstrates best practices throughout

### Good (80-89)
- Strong across all major criteria
- Minor areas for improvement identified
- Functional tooling and good documentation
- Follows established patterns consistently

### Fair (70-79)
- Functional but needs significant improvements
- Several areas below quality standards
- Limited tooling or documentation gaps
- Inconsistent application of patterns

### Poor (60-69)
- Major issues that need addressing
- Multiple criteria below acceptable levels
- Missing essential components or documentation
- Requires substantial refactoring

### Critical (<60)
- Fundamental problems with structure or content
- Does not meet basic quality requirements
- Significant gaps in functionality or documentation
- Likely needs complete redesign
