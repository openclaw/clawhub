---
module: language-support
category: detection
dependencies: [Read]
estimated_tokens: 400
---

# Multi-Language Slop Detection

## Supported Languages

| Code | Language | Tier Coverage | Calibration |
|------|----------|---------------|-------------|
| en | English | Full (Tier 1-4, phrases, fiction, sycophantic) | 1.0 (baseline) |
| de | German | Core (Tier 1-2, key phrases) | 0.85 |
| fr | French | Core (Tier 1-2, key phrases) | 0.80 |
| es | Spanish | Core (Tier 1-2, key phrases) | 0.85 |
| pt | Portuguese | Core (Tier 1-2, key phrases) | 0.85 |
| it | Italian | Core (Tier 1-2, key phrases) | 0.80 |

## Language Detection

Auto-detection uses function word frequency analysis. Common words like articles,
prepositions, and auxiliary verbs serve as language markers.

Detection is conservative: defaults to English unless another language has
significantly more markers in the text.

### Override

Specify language explicitly when auto-detection is unreliable:
- Mixed-language documents
- Short texts (< 100 words)
- Code-heavy documents

## Pattern Loading

Patterns are stored in `data/languages/{code}.yaml` with consistent structure:

```yaml
language: xx
name: Language Name
tier1:
  power_words: [...]
  sophistication_signals: [...]
  metaphor_abuse: [...]
tier2:
  transition_overuse: [...]
  hedging: [...]
  business_jargon: [...]
phrases:
  vapid_openers:
    score: 4
    patterns: [...]
  filler:
    score: 2
    patterns: [...]
```

## Cultural Considerations

Slop perception varies by culture:
- **German**: Formal register is more accepted; fewer words flagged as pretentious
- **French**: Literary flourishes are culturally valued; calibrate sensitivity
- **Spanish**: Formal transitions are standard in academic writing
- **Portuguese**: Academic norms closely follow Spanish; formal phrasing less penalised
- **Italian**: Literary style is culturally valued, similar to French calibration

Structural metrics (em dashes, bullet ratios) are language-agnostic.

## Scoring Calibration

Each language has a calibration factor (see `LANGUAGE_CALIBRATION` in `pattern_loader.py`).
Multiply raw slop scores by this factor before reporting. English is the baseline (1.0).
Languages with a factor below 1.0 are less penalised for formal or literary register.
