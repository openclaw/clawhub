# Uncertainty Estimation

The LLM self-estimates whether current evidence is sufficient to act
confidently.
This is the weakest signal in the utility function (Pearson r=0.0131
with final quality) but serves as a useful tiebreaker when gain and
cost scores are close.

## Output

`Uncertainty(a | s_t) -> [0, 1]`

## Behavioral Effect

High uncertainty pushes toward retrieve or verify actions.
Low uncertainty pushes toward respond or stop actions.

## Anchoring Scale

| Range   | Meaning                                                   |
|---------|-----------------------------------------------------------|
| 0.0-0.2 | Evidence is strong; confident in current state            |
| 0.3-0.5 | Some gaps exist but reasonable to proceed                 |
| 0.6-0.8 | Significant unknowns present; more retrieval warranted    |
| 0.9-1.0 | Very uncertain; should not respond yet                    |

## Estimation Prompts

Ask yourself these three questions before scoring:

1. How many of the relevant files or resources have I examined?
2. Are there known unknowns I haven't yet addressed?
3. Could my current answer be wrong in a way that matters?

Score higher when coverage is low, known unknowns remain open, or the
answer has a plausible failure mode you haven't ruled out.
Score lower when coverage is broad, no critical gaps remain, and the
answer holds up under a quick adversarial check.

## Calibration Warning

The paper found Pearson r=0.0131 between self-estimated uncertainty
and final quality.
This is weak correlation.
Treat this signal as a tiebreaker, not a primary driver.
It is weighted at lambda_2=0.5 in the combined utility formula
precisely because over-relying on it degrades decision quality.

## Scope-Specific Notes

**self** — Uncertainty about your own evidence base: have you read
the files and called the tools needed to answer the question?

**subagent** — Uncertainty about your assigned task specifically:
are there task requirements you haven't confirmed or edge cases you
haven't checked?

**dispatch** — Uncertainty about whether existing agents have covered
the problem space: are there dimensions of the problem no agent has
been assigned?

Match the question to your current execution scope before scoring.
