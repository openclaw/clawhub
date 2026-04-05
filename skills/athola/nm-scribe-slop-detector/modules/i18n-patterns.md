---
module: i18n-patterns
category: detection
dependencies: [Read, Grep]
estimated_tokens: 700
---

# Internationalisation Pattern Detection

Slop markers exist in every language. This module extends detection to German, French,
and Spanish. The same density scoring applies: tier-1 words score 3 each, tier-3
phrases score 4 each, normalised per 100 words.

## Language Selection

### Step 1 - Check config

Look for a `languages` key in `.slop-config.yaml`:

```yaml
languages:
  - en
  - de
```

If `languages` is set, scan only those pattern sets. If absent, fall back to
heuristic detection.

### Step 2 - Heuristic (no config)

Sample the first 200 words. Count function-word hits:

| Language | Function words |
|----------|----------------|
| German   | der, die, das, und, ist, nicht, mit, von |
| French   | le, la, les, et, est, pas, avec, une, dans |
| Spanish  | el, la, los, las, es, con, una, por, que |

Use the highest-scoring language. If the top score is below 5, treat the document
as English only and skip this module.

---

## German (de)

```python
DE_TIER1_PATTERNS = [
    r'\bumfassend\w*\b',    # umfassend, umfassende, umfassender ...
    r'\bnutzen\b',
    r'\bvielf[äa]ltig\w*\b',
    r'\btiefgreifend\w*\b',
    r'\bbahnbrechend\w*\b',
    r'\bganzheitlich\w*\b',
    r'\bmaßgeblich\w*\b',
    r'\bwegweisend\w*\b',
]

DE_PHRASE_PATTERNS = [
    r'in der heutigen schnelllebigen welt',  # vapid opener
    r'es sei darauf hingewiesen',            # filler
]
```

---

## French (fr)

`tirer parti de` is a multi-word phrase treated as a single tier-1 unit.

```python
FR_TIER1_PATTERNS = [
    r'\btirer parti de\b',
    r'\bexhaustif(?:ve)?\b|\bexhaustive\b',  # exhaustif / exhaustive
    r'\bpolyvalent\w*\b',
    r'\bincontournable[s]?\b',
    r'\bnovateur\b|\bnovatrice\b',
    r'\bprimordial\w*\b',
]

FR_PHRASE_PATTERNS = [
    r"dans le monde d'aujourd'hui",  # vapid opener
    r'il convient de noter que',     # filler
]
```

---

## Spanish (es)

```python
ES_TIER1_PATTERNS = [
    r'\baprovechar?\b',          # aprovechar
    r'\bintegral[e-z]?\b',       # integral
    r'\bpolifac[eé]tico[s]?\b',  # polifacético
    r'\binnovador[a-z]?\b',      # innovador
    r'\bfundamental[e-z]?\b',    # fundamental
    r'\bimprescindible[s]?\b',   # imprescindible
]

ES_PHRASE_PATTERNS = [
    r'en el mundo acelerado de hoy',  # vapid opener
    r'cabe destacar que',             # filler
]
```

---

## Scoring and reporting

Add i18n matches to the overall document score:

```
slop_score += (tier1_count * 3 + phrase_count * 4) / word_count * 100
```

Report language-specific hits in a subsection:

```
### Non-English Markers (de)
- Line 4: "bahnbrechend" -> consider: "neu" or be specific
- Line 12: "In der heutigen schnelllebigen Welt" (vapid opener)
```

If two or more languages score above 5 in the heuristic, apply all matching
pattern sets and label each match with its language code.
