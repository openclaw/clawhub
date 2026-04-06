---
module: structural-patterns
category: detection
dependencies: [Bash, Grep]
estimated_tokens: 600
---

# Structural Pattern Detection

AI-generated text exhibits distinctive structural patterns beyond vocabulary.

## Em Dash Analysis

AI uses em dashes (—) excessively as a rhetorical device.

```bash
# Count em dashes per file
em_count=$(grep -o '—' "$file" | wc -l)
word_count=$(wc -w < "$file")
density=$((em_count * 1000 / word_count))
```

| Density (per 1000 words) | Signal |
|--------------------------|--------|
| 0-2 | Normal |
| 3-5 | Elevated |
| 6-10 | High AI signal |
| 10+ | Very high AI signal |

## Tricolon Detection

AI produces alliterative groups of three with suspicious frequency.

Pattern examples:
- "clear, concise, and compelling"
- "fast, flexible, and free"
- "robust, reliable, and resilient"

Detection approach:
```python
# Look for: adjective, adjective, and adjective
tricolon_pattern = r'\b(\w+), (\w+),? and (\w+)\b'
# Flag if words share first letter or similar endings
```

## Sentence Length Uniformity

Human writing varies naturally. AI tends toward medium-length sentences.

```python
def sentence_uniformity(sentences):
    lengths = [len(s.split()) for s in sentences]
    mean = sum(lengths) / len(lengths)
    variance = sum((l - mean) ** 2 for l in lengths) / len(lengths)
    std_dev = variance ** 0.5
    return std_dev

# std_dev < 5: Suspicious uniformity
# std_dev 5-15: Normal variation
# std_dev > 15: High variation (human)
```

## Paragraph Symmetry

AI produces "blocky" text with uniform paragraph lengths.

```bash
# Check paragraph length distribution
awk '/^$/{if(p)print p; p=0; next}{p+=NF}END{print p}' file.md | sort -n | uniq -c
```

If most paragraphs cluster around the same length (e.g., 40-60 words), flag as AI signal.

## Bullet-to-Prose Ratio

AI defaults to bullet points, especially with emojis.

```bash
# Count bullet lines vs total lines
bullet_lines=$(grep -c '^\s*[-*]' file.md)
total_lines=$(wc -l < file.md)
ratio=$((bullet_lines * 100 / total_lines))
```

| Ratio | Signal |
|-------|--------|
| 0-30% | Normal |
| 30-50% | Elevated |
| 50-70% | High (check context) |
| 70%+ | Very high AI signal |

**Emoji bullets** (e.g., lines starting with emoji) in technical documentation are a strong AI tell.

## Five-Paragraph Essay Structure

AI defaults to: intro + three body sections + conclusion recap.

Check for:
1. Opening paragraph that restates the question
2. Three distinct middle sections
3. Closing paragraph that summarizes without adding new information

## Perfect Grammar Signals

| Pattern | Human Range | AI Signal |
|---------|-------------|-----------|
| Contractions | Common | Rare/absent |
| Oxford commas | Variable | Always present |
| Typos | Occasional | None |
| Sentence fragments | Present | Rare |
| Starting with "And" or "But" | Common | Rare |

## Register Uniformity

Human writing shifts between abstract and concrete, formal and casual. AI maintains consistent register throughout.

Check for:
- Absence of colloquialisms
- No slang or informal expressions
- Uniform formality level across all sections

## Participial Phrase Tail-Loading

AI appends present participial (-ing) phrases to sentence ends at 2-5x the human rate (Wagner 2025).

Pattern: `[Main clause], [present participle] [detail].`

Examples:
- "The team developed a framework, **enabling** researchers to analyze data."
- "The policy was implemented, **marking** a shift in approach."
- "She published findings, **contributing** to the body of research."

```python
# Detect sentences ending with ", [word]-ing ..."
participial_tail = r',\s+\w+ing\s+[\w\s]+\.$'
# 3+ matches in a paragraph is a strong signal
```

| Count per 500 words | Signal |
|---------------------|--------|
| 0-1 | Normal |
| 2-3 | Elevated |
| 4+ | Strong AI signal |

## "From X to Y" Range Construction

AI uses this template to express scope at much higher rates than human writers.

Examples:
- "From bustling cities to serene landscapes"
- "From beginners to experts"
- "From ancient traditions to modern innovations"

```python
from_to_pattern = r'\bfrom\s+[\w\s]+\s+to\s+[\w\s]+'
```

## Correlative Conjunction Overuse

AI over-relies on correlative pairs in close proximity:

| Pattern | Example |
|---------|---------|
| "whether...or" | "Whether you're a beginner or an expert" |
| "not only...but also" | "Not only does it improve X, but also Y" |
| "not just...but" | "Not just a tool, but a transformation" |

2+ correlative pairs in the same paragraph is a signal.

## ASCII Arrow Prose Connector

AI uses `->` and `→` as prose shorthand instead of writing
"to", "into", or "produces". Arrows are fine in code, type
signatures, and diagrams but mark AI-generated prose.

Examples:
- "spec -> plan -> tasks" (slop)
- "spec to plan to tasks" (human)
- "returns `int -> str`" (fine, code context)

```bash
# Detect arrows in prose (exclude code blocks)
awk '/^```/{c=!c}!c' file.md | grep -oP '\s->\s|→' | wc -l
```

## Plus-Sign Conjunction

AI uses `+` as a conjunction ("X + Y") in prose instead of
"and" or "with". Fine in code, math, and labels.

Examples:
- "hooks + skills" (slop)
- "hooks and skills" (human)
- "1 + 1 = 2" (fine, math)

```bash
# Detect prose plus signs (word + word pattern)
awk '/^```/{c=!c}!c' file.md | grep -oP '\w\s\+\s\w' | wc -l
```

## Colon Addiction

AI uses colons to introduce explanations at 3-5x the human rate.

Pattern: "Topic: explanation" as a sentence structure.

```bash
# Count colons used as sentence-internal punctuation
grep -oP '(?<=[a-z]): (?=[A-Z])' file.md | wc -l
```

Combined with em dash overuse, this creates a "punctuation for professionalism" signature.

## Semicolon Avoidance

AI rarely uses semicolons. The ratio of em dashes to semicolons is skewed compared to human writing, where semicolons appear in roughly 1 in 50 sentences for experienced writers.

```bash
em_dashes=$(grep -o '—' file.md | wc -l)
semicolons=$(grep -o ';' file.md | wc -l)
# Human ratio: roughly equal. AI ratio: 10:1 or worse.
```

## Sentence Length Clustering (Refined)

Beyond uniformity (tracked above), the specific AI cluster is **15-25 words per sentence**. Human writing ranges from 3-word fragments to 40+ word complex sentences. AI avoids both extremes.

```python
def length_clustering(sentences):
    lengths = [len(s.split()) for s in sentences]
    in_range = sum(1 for l in lengths if 15 <= l <= 25)
    return in_range / len(lengths)

# > 0.7 (70% of sentences in 15-25 range): strong AI signal
```

## Topic-Evidence-Summary Paragraph Template

AI paragraphs follow a rigid structure:
1. Topic sentence (states the point)
2. Supporting detail (1-3 sentences)
3. Summary/transition (restates or bridges)

Human writers vary this: some paragraphs are all evidence, some start with a question, some end abruptly.

Detection: check if the first and last sentences of each paragraph express the same idea using different words.

## Conclusion Mirroring

AI introductions and conclusions are near-paraphrases of each other. Check cosine similarity between first and last paragraphs.

Human writing ends with specifics, callbacks to earlier points, questions, or simply stops.

## Structural Score Calculation

```python
def structural_score(metrics):
    score = 0
    if metrics['em_dash_density'] > 5:
        score += 2
    if metrics['sentence_std_dev'] < 5:
        score += 2
    if metrics['bullet_ratio'] > 0.5:
        score += 2
    if metrics['paragraph_uniformity'] > 0.8:
        score += 2
    if metrics['zero_contractions']:
        score += 1
    if metrics['emoji_bullets']:
        score += 3
    # New patterns (2025-2026 research)
    if metrics.get('participial_tail_count', 0) > 3:
        score += 2
    if metrics.get('sentence_length_cluster_ratio', 0) > 0.7:
        score += 2
    if metrics.get('semicolon_count', 1) == 0 and metrics.get('em_dash_density', 0) > 3:
        score += 1  # em dashes without semicolons
    if metrics.get('correlative_pairs', 0) > 2:
        score += 1
    if metrics.get('arrow_connectors', 0) > 0:
        score += 1
    if metrics.get('plus_conjunctions', 0) > 1:
        score += 1
    return min(10, score)
```
