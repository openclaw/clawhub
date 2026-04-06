---
module: fiction-patterns
category: detection
dependencies: [Grep, Read]
estimated_tokens: 700
---

# Fiction-Specific AI Pattern Detection

Creative writing has distinct AI tells beyond technical documentation markers.

## Physical/Emotional Cliche Beats

AI defaults to formulaic body language and emotional descriptions.

### Breath Cliches (Score: 3 each)
```
"breath he didn't know he was holding"
"let out a breath"
"released a breath"
"exhaled a breath he'd been holding"
"breath caught in [his/her] throat"
```

### Body Protest Metaphors (Score: 2 each)
```
"[body part] protested"
"his shoulder protests"
"muscles screamed in protest"
"[body part] screamed"
```

### Emotion Washing (Score: 3 each)
```
"relief washed over"
"[emotion] washed over"
"a sense of [emotion] washed"
"dread pooled in [his/her] stomach"
"heart clenched"
```

### Vague Depth Markers (Score: 3 each)
```
"something in [his/her] expression"
"something in [his/her] eyes"
"something shifted"
"something precious"
"something soft in"
"something [adjective] in [his/her] voice"
```

### Decision/Reaction Avoidance (Score: 2 each)
```
"doesn't know what to do with that"
"didn't know what to do with"
"couldn't process"
"brain short-circuited"
```

## Narrative Structure Cliches

### Simile Abuse (Score: 2-4 each)
```
"like it's the most natural thing in the world" (4)
"like a vow" (3)
"like a promise" (3)
"like coming home" (3)
"like a blade wrapped in silk" (4)
"stone in still water" (4)
```

### Rhetorical Emphasis (Score: 3 each)
```
"He x—really x—" pattern
"He looked at her—really looked"
"He listened—really listened"
"Not x but y" / "Not x, just y"
"didn't [verb] but [verb]"
```

### Sentence Fragment Overuse

AI uses stylistic fragments excessively for "punch":
```
"Tosses it somewhere behind him."
"Gone."
"Just like that."
"Nothing more."
```

One or two per scene is stylistic; five or more signals generation.

## Word-Level Fiction Tells

### Overused Descriptors
```
cataloguing, measured, clocked, flickering,
perhaps, maybe, just, that, something,
kind of, sort of
```

### Action Inflation
```
screaming (metaphorical: "hip screaming")
protesting (body parts)
dancing (non-dance contexts: "fingers dancing")
singing (objects: "the blade sang")
```

### Adverb Clustering

AI repeats the same adverbs within short spans:
- "softly" appearing 3+ times in a scene
- "quietly" used with multiple actions
- "slowly" describing everything

Check adverb variety: count unique adverbs vs total adverb uses.

## Dialogue Patterns

### Sycophantic Character Speech
```
"That's a great idea"
"You're absolutely right"
"I never thought of it that way"
```

### Overly Clean Attribution
AI avoids "said" excessively:
```
he murmured, she whispered, he breathed,
she exhaled, he muttered, she remarked
```

Natural dialogue uses "said" frequently without variation.

## Chapter/Scene Structure

### Upbeat Endings

AI ends scenes with false resolution:
- Characters reaching understanding
- Hopeful forward-looking statements
- Emotional catharsis without buildup

### Character Name Patterns

AI defaults to certain names with suspicious frequency:
- Sarah Chen (extremely common in AI fiction)
- Emma, Liam, Maya, Marcus
- Asian names with Western first names

## Detection Regex

```python
FICTION_PATTERNS = [
    r"breath \w+ didn't know",
    r"let out a breath",
    r"\w+ protested?(?:\s|$)",
    r"(?:relief|fear|dread|panic) washed over",
    r"something (?:in|about) (?:his|her)",
    r"like (?:it's|it was) the most natural",
    r"—really \w+—",
    r"(?:didn't|doesn't) know what to do with",
]
```

## Scoring for Fiction

```python
def fiction_slop_score(text):
    patterns_found = []
    for pattern, score in FICTION_PATTERNS:
        matches = re.findall(pattern, text, re.IGNORECASE)
        patterns_found.extend([(m, score) for m in matches])

    # Weight by scene length (per 500 words)
    word_count = len(text.split())
    raw_score = sum(score for _, score in patterns_found)
    normalized = (raw_score / word_count) * 500

    return {
        'score': min(10, normalized),
        'patterns': patterns_found,
        'density': len(patterns_found) / (word_count / 500)
    }
```

## Remediation Notes

Fiction slop requires rewriting, not just word replacement. The underlying issue is reliance on familiar emotional beats rather than character-specific reactions.

Recommend:
1. What would THIS character actually do/feel?
2. What sensory details are specific to this scene?
3. What's the subtext beneath the surface emotion?
