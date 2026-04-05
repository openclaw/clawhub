---
module: vocabulary-patterns
category: detection
dependencies: [Grep, Read]
estimated_tokens: 800
---

# Vocabulary Pattern Detection

Comprehensive word and phrase lists for AI slop detection, organized by confidence level and category.

## Tier 1: Highest Confidence Words

These words appear dramatically more often in AI-generated text. Research shows some (like "delve") appeared 10-25x more frequently after 2023.

### Power Words (Overinflated Verbs)
```
delve, embark, unleash, unlock, revolutionize, spearhead,
foster, harness, elevate, transcend, forge, ignite,
propel, catalyze, galvanize, amplify
```

### Sophistication Signals (False Depth)
```
multifaceted, nuanced, intricate, meticulous, profound,
comprehensive, holistic, robust, pivotal, paramount,
indispensable, quintessential
```

### Metaphor Abuse
```
tapestry, beacon, realm, landscape, symphony, mosaic,
crucible, labyrinth, odyssey, cornerstone, bedrock,
linchpin, nexus
```

### Display Verbs
```
showcasing, exemplifying, demonstrating, illuminating,
underscoring, highlighting, epitomizing
```

## Tier 2: Medium Confidence Words

Context-dependent markers that become problematic in clusters.

### Transition Overuse
```
moreover, furthermore, indeed, notably, subsequently,
consequently, additionally, likewise, nonetheless,
henceforth, thereby, whereby
```

### Hedging Stacks
```
potentially, typically, generally, arguably, presumably,
ostensibly, conceivably, seemingly, perhaps, might
```

### Intensity Words
```
significantly, substantially, fundamentally, profoundly,
dramatically, tremendously, remarkably, exceedingly,
immensely, vastly
```

### Business Jargon
```
leverage, synergy, optimize, streamline, scalability,
actionable, deliverables, stakeholders, bandwidth,
paradigm, disruptive, ecosystem
```

### Tech Buzzwords
```
cutting-edge, state-of-the-art, next-gen, AI-powered,
game-changing, innovative, transformative, seamless,
user-friendly, best-in-class
```

## Tier 3: Phrase Patterns

### Vapid Openers (Score: 4)
```
"In today's fast-paced world"
"In an ever-evolving landscape"
"In the dynamic world of"
"In this digital age"
"As technology continues to evolve"
"In the realm of"
```

### Empty Emphasis (Score: 3)
```
"cannot be overstated"
"goes without saying"
"needless to say"
"it bears mentioning"
"of paramount importance"
"absolutely essential"
```

### Filler Phrases (Score: 2)
```
"it's worth noting that"
"it's important to understand"
"at its core"
"from a broader perspective"
"through this lens"
"when it comes to"
"at the end of the day"
```

### Attribution Cliches (Score: 3)
```
"a testament to"
"serves as a reminder"
"stands as proof"
"speaks volumes about"
"a shining example of"
```

### Marketing/Sales Speak (Score: 4)
```
"look no further"
"unlock the potential"
"unleash the power"
"treasure trove of"
"game changer"
"take it to the next level"
"best kept secret"
```

### Travel/Place Cliches (Score: 4)
```
"nestled in the heart of"
"bustling streets"
"hidden gem"
"off the beaten path"
"steeped in history"
"a feast for the senses"
```

### Journey Metaphors (Score: 3)
```
"embark on a journey"
"navigate the complexities"
"pave the way"
"chart a course"
"at a crossroads"
```

## Tier 4: Research-Validated Markers (2025-2026)

From peer-reviewed studies on AI text detection (PMC12219543, arXiv 2503.01659v1).

### High-Frequency Shift Words

These common words had the largest frequency increase in post-ChatGPT text. Individually unremarkable; their co-occurrence is the signal.

**10-word co-occurrence test** (5+ in a single paragraph = strong signal):
```
across, additionally, comprehensive, crucial, enhancing,
exhibited, insights, notably, particularly, within
```

### New Verbs (Score: 3 each)
```
underscore(s), bolster, foster, harness, illuminate,
elucidate, grapple, reimagine, intertwine, exemplify,
evoke, emulate, transcend, unravel
```

Note: "underscores the importance" is a near-diagnostic construction (13.8x human baseline frequency).

### New Adjectives (Score: 2-3 each)
```
seamless, invaluable, dynamic, whimsical, vibrant,
timeless, sustainable (outside environmental context)
```

### New Adverbs (Score: 2 each)
```
aptly, tirelessly, seamlessly, vividly
```

### New Nouns (Score: 2 each)
```
interplay, facet, symphony (metaphorical), endeavor,
synergy, insights (as padding: "provides valuable insights")
```

### Hedging Constructions (Score: 2-3 each)
```
"It's important to note that"
"It's important to remember that"
"Generally speaking"
"To some extent"
"From a broader perspective"
"One might argue that"
"It could be said that"
"There is growing evidence that"
```

### Conclusion Starters (Score: 2 each)
```
"Overall, "
"In conclusion, "
"In summary, "
"Ultimately, "
"To sum up, "
```

These overwhelmingly start AI conclusions. Human writers end with specifics, callbacks, or questions.

### Sycophantic Positivity (Score: 3 each)
```
"areas for improvement" (avoids saying "problems")
"invaluable resource"
"exceptional"
"remarkable"
```

AI text is measured at 50% more sycophantic than human text (Georgetown AI Sycophancy Research, 2025).

## Detection Regex Patterns

For automated scanning:

```python
TIER1_PATTERNS = [
    r'\bdelve\b', r'\bembark\b', r'\btapestry\b', r'\brealm\b',
    r'\bbeacon\b', r'\bmultifaceted\b', r'\bpivotal\b', r'\bnuanced\b',
    r'\bmeticulous(?:ly)?\b', r'\bintricate\b', r'\bshowcasing\b',
    r'\bleveraging\b', r'\bstreamline\b', r'\bunleash\b',
]

TIER1_NEW_PATTERNS = [
    r'\bunderscore[sd]?\b', r'\bbolster\b', r'\bfoster\b',
    r'\billumicat[es]\b', r'\belucidat[es]\b', r'\bgrapple\b',
    r'\breimaginc[es]\b', r'\bintertwine[ds]?\b', r'\bexemplif(?:y|ies)\b',
    r'\bseamless(?:ly)?\b', r'\binvaluable\b', r'\bvibrant\b',
    r'\binterplay\b', r'\bfacet[s]?\b', r'\bendeavor[s]?\b',
    r'\baptly\b', r'\btirelessly\b', r'\bvividly\b',
]

PHRASE_PATTERNS = [
    r"in today's fast-paced",
    r'cannot be overstated',
    r"it's worth noting",
    r'at its core',
    r'a testament to',
    r'unlock the (?:full )?potential',
    r'embark on (?:a |the )?journey',
    r'nestled in the heart',
    r'treasure trove',
    r'game[- ]changer',
    r"it's important to (?:note|remember|understand) that",
    r'generally speaking',
    r'from a broader perspective',
    r'one might argue',
    r'it could be said',
    r'there is growing evidence',
    r'areas for improvement',
    r'invaluable resource',
    r'underscores the importance',
]

# Conclusion starters (check first word of last paragraph)
CONCLUSION_STARTERS = [
    r'^Overall,',
    r'^In conclusion,',
    r'^In summary,',
    r'^Ultimately,',
    r'^To sum up,',
]

# Co-occurrence test: 5+ of these in one paragraph = strong signal
HIGH_FREQ_SHIFT_WORDS = [
    'across', 'additionally', 'comprehensive', 'crucial', 'enhancing',
    'exhibited', 'insights', 'notably', 'particularly', 'within',
]
```

## Contextual Adjustments

Not all usage is problematic:

| Word | Acceptable Context | Problematic Context |
|------|-------------------|---------------------|
| delve | Technical deep-dive | Generic exploration |
| leverage | Physics/mechanics | Business jargon |
| robust | Engineering specs | Marketing claims |
| seamless | UX testing results | Feature descriptions |
| journey | Actual travel | Metaphor abuse |

## Scoring Formula

```python
def calculate_vocabulary_score(text, word_count):
    tier1_matches = count_tier1_matches(text)
    tier2_matches = count_tier2_matches(text)
    phrase_matches = count_phrase_matches(text)

    raw_score = (tier1_matches * 3) + (tier2_matches * 2) + (phrase_matches * 3)
    normalized = (raw_score / word_count) * 100

    return min(10.0, normalized)  # Cap at 10
```
