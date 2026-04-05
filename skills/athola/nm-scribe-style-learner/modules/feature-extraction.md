---
module: feature-extraction
category: style-analysis
dependencies: [Bash, Read]
estimated_tokens: 400
---

# Feature Extraction Module

Quantitative style metrics extraction from exemplar text.

## Vocabulary Analysis

```bash
# Average word length
awk '{for(i=1;i<=NF;i++){sum+=length($i);count++}}END{print sum/count}' file.md

# Unique word ratio
words=$(tr '[:space:]' '\n' < file.md | grep -v '^$' | wc -l)
unique=$(tr '[:space:]' '\n' < file.md | grep -v '^$' | sort -u | wc -l)
echo "scale=2; $unique / $words" | bc

# Contraction count
grep -oE "\b\w+'(t|s|d|ll|ve|re|m)\b" file.md | wc -l
```

## Sentence Analysis

```python
import re

def analyze_sentences(text):
    # Split on sentence boundaries
    sentences = re.split(r'[.!?]+', text)
    sentences = [s.strip() for s in sentences if s.strip()]

    lengths = [len(s.split()) for s in sentences]

    return {
        'count': len(sentences),
        'avg_length': sum(lengths) / len(lengths),
        'min_length': min(lengths),
        'max_length': max(lengths),
        'std_dev': statistics.stdev(lengths) if len(lengths) > 1 else 0,
        'questions': sum(1 for s in sentences if '?' in s),
        'fragments': sum(1 for l in lengths if l < 5)
    }
```

## Structural Analysis

```bash
# Paragraph lengths (sentences per paragraph)
awk -v RS='\n\n' '{
    gsub(/[.!?]/, "&\n");
    n = split($0, a, "\n");
    print n
}' file.md

# List ratio
bullets=$(grep -c '^\s*[-*]' file.md)
total=$(wc -l < file.md)
echo "scale=2; $bullets / $total" | bc

# Header depth
grep -E '^#{1,6}\s' file.md | head -1 | grep -o '#' | wc -c
```

## Punctuation Profile

```bash
# Per 1000 words
words=$(wc -w < file.md)

em_dashes=$(grep -o '—' file.md | wc -l)
semicolons=$(grep -o ';' file.md | wc -l)
exclamations=$(grep -o '!' file.md | wc -l)
colons=$(grep -o ':' file.md | wc -l)

echo "Em dashes: $((em_dashes * 1000 / words)) per 1000"
echo "Semicolons: $((semicolons * 1000 / words)) per 1000"
```

## Output Format

```yaml
vocabulary:
  avg_word_length: 5.2
  unique_ratio: 0.42
  contraction_rate: 3.5  # per 100 sentences

sentences:
  avg_length: 18.4
  std_dev: 8.2
  question_rate: 2.1  # per 100
  fragment_rate: 1.5  # per 100

structure:
  avg_paragraph_sentences: 4.2
  list_ratio: 0.15
  max_header_depth: 3

punctuation:
  em_dash_rate: 1.8  # per 1000 words
  semicolon_rate: 0.5
  exclamation_rate: 0.2
```
