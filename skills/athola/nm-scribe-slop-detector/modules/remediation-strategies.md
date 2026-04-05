---
module: remediation-strategies
category: writing-quality
dependencies: [Edit, Write]
estimated_tokens: 600
---

# AI Slop Remediation Strategies

Guidance for fixing detected slop patterns while preserving meaning.

## Core Principles

1. **Preserve meaning**: Never change what's said, only how it's said
2. **Match context**: Technical docs need different fixes than narratives
3. **Maintain voice**: If the document has established tone, preserve it
4. **Incremental changes**: Edit section by section, not wholesale rewrites
5. **Ask before gutting**: Major restructuring requires user approval

## Vocabulary Remediation

### Direct Substitutions

| AI Word | Context | Replacements |
|---------|---------|-------------|
| delve | exploration | explore, examine, look at, dig into |
| leverage | usage | use, apply, employ |
| utilize | usage | use |
| embark | starting | begin, start, launch |
| comprehensive | scope | thorough, complete, full |
| robust | quality | solid, strong, reliable |
| seamless | integration | smooth, easy, simple |
| pivotal | importance | key, important, critical |
| multifaceted | complexity | complex, varied, diverse |
| nuanced | detail | subtle, detailed, fine-grained |
| streamline | improvement | simplify, improve, speed up |
| optimize | improvement | improve, tune, adjust |
| facilitate | enablement | enable, help, allow |
| utilize | use | use |

### Phrase Substitutions

| AI Phrase | Replacement Options |
|-----------|---------------------|
| "In today's fast-paced world" | [Delete entirely] or start with the actual point |
| "It's worth noting that" | [Delete] - just state the thing |
| "At its core" | "Fundamentally" or [delete] |
| "Cannot be overstated" | "is important" or "matters because [reason]" |
| "Navigate the complexities" | "handle", "work through", "deal with" |
| "Unlock the potential" | "enable", "allow", "make possible" |
| "A testament to" | "shows", "demonstrates", "proves" |
| "Treasure trove" | "collection", "set", "many" |

## Structural Remediation

### Reducing Em Dashes

Replace with:
- Commas for brief asides
- Parentheses for tangential info
- Periods for complete thoughts
- Colons for introductions

Before: "The system—which was designed for scale—handles millions of requests."
After: "The system handles millions of requests. It was designed for scale."

### Converting Bullets to Prose

Before:
```
Key benefits:
- Fast processing
- Easy integration
- Low maintenance
```

After:
"The system processes quickly, integrates without friction, and requires little upkeep."

### Varying Sentence Length

If all sentences are 15-20 words, intersperse:
- Short punchy statements (5-8 words)
- Longer explanatory sentences (25-30 words)
- Questions or fragments for emphasis

### Adding Contractions

Replace formal constructions:
- "do not" -> "don't"
- "cannot" -> "can't"
- "it is" -> "it's"
- "we will" -> "we'll"

Exception: Legal, academic, or formal documents may require formality.

## Tone Remediation

### Removing Sycophancy

| Remove | Replace With |
|--------|--------------|
| "Great question!" | [Delete, just answer] |
| "I'd be happy to" | [Delete, just do it] |
| "Absolutely!" | [Delete or use sparingly] |
| "That's a wonderful point" | [Delete] |

### Adding Authorial Voice

Insert:
- First-person perspective where appropriate
- Specific examples from real experience
- Acknowledgment of limitations or unknowns
- Trade-off discussions with reasoning

Before: "This approach optimizes performance."
After: "We chose this approach because it cut latency by 40% in our tests, though it uses more memory."

### Grounding Abstract Claims

Before: "This provides comprehensive coverage."
After: "This covers all 47 API endpoints documented in v2.3."

## Section-by-Section Workflow

For documents over 200 lines:

1. **Scan entire document** for slop density
2. **Prioritize sections** by severity
3. **Present each section** to user with proposed changes
4. **Wait for approval** before proceeding
5. **Track changes** in a summary

```markdown
## Section 3: API Overview (Lines 45-89)

**Slop Score**: 4.2 (Moderate)

**Proposed Changes**:
1. Line 47: "delve into" -> "examine"
2. Line 52: Remove "In today's fast-paced world"
3. Lines 60-75: Convert bullet list to two paragraphs

Proceed with these changes? [Y/n/edit]
```

## Docstring Remediation

Special rules for code comments:

1. **Imperative mood**: "Validate" not "Validates"
2. **No surrounding code changes**: Only modify the comment text
3. **Preserve parameter documentation**: Keep Args/Returns format
4. **Brief is better**: Remove filler, keep essential info

Before:
```python
def process(data):
    """
    This function processes the data in a comprehensive manner,
    leveraging advanced algorithms to optimize the output.
    """
```

After:
```python
def process(data):
    """Process input data and return optimized result."""
```

## When NOT to Remediate

- **Quoted material**: Don't change quotes from other sources
- **Historical documents**: Preserve original language
- **Intentional style**: Some "AI-like" formality may be intentional
- **User preference**: If user wants formal tone, respect it
