# Gain Estimation

The LLM self-estimates the marginal value of taking a candidate action
before executing it.
This is a heuristic signal, not a calibrated probability.

## Output

`Gain(a | s_t) -> [0, 1]`

## Anchoring Scale

| Range   | Meaning                                              |
|---------|------------------------------------------------------|
| 0.0-0.2 | Answer is sufficient; action is speculative          |
| 0.3-0.5 | Known gap exists; action might address it            |
| 0.6-0.8 | Clear gap exists; action likely addresses it         |
| 0.9-1.0 | Critical missing piece; action directly fills it     |

## Estimation Prompts

Ask yourself these three questions before acting:

1. Does this action address an open task or an identified gap in my
   current answer?
2. How much new information is expected versus what I have already
   observed?
3. Is the current answer sufficient, or does it have clear, specific
   gaps?

Score higher when the answer to (1) is yes, (2) is substantial, and
(3) points to a specific deficit.
Score lower when the answer is already adequate or the action is
exploratory.

## Scope-Specific Guidance

**self** — Will reading this file or calling this tool fill a specific
gap in my current understanding?

**subagent** — Will this finding advance my assigned task, or am I
exploring outside my scope?

**dispatch** — Will this agent produce findings that existing agents
haven't covered?

Match the question to your current execution scope before scoring.

## Task-Aware Gain Boost

Actions that are directly mapped to the active `current_task_id`
receive a +0.1 bonus, capped at 1.0.
Use this boost only when the action explicitly advances the tracked
task, not for tangentially related work.

## Anti-Pattern

Never assign 0.9+ to a speculative action.
Reserve the top tier for cases where the missing information is
specifically identified and the action is known to retrieve it.
A vague sense that more information might help is a 0.3-0.5 score,
not a 0.9.
