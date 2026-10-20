# Application model policy

Default policy as of 2026-10-19 (embeddings unchanged):

| Consumer                                               | Model         | Reasoning | Service  |
| ------------------------------------------------------ | ------------- | --------- | -------- |
| Skill summaries; skill/package changelogs              | `gpt-6-luna`  | low       | Standard |
| Plugin and Claw category classification; search intent | `gpt-6-luna`  | none      | Standard |
| Skill Card generator and credential canary             | `gpt-6-luna`  | medium    | Standard |
| Design audit                                           | `gpt-6.1-sol` | high      | Standard |
| SkillEvaluator Codex agent                             | `gpt-6.1-sol` | medium    | Standard |
| SkillEvaluator judge                                   | `gpt-6.1-sol` | high      | Standard |

Existing model, effort, and service-tier environment overrides remain explicit
operator choices. Other explicit model families keep their provider reasoning
defaults instead of receiving unsupported effort values; Sol category overrides
use its supported minimum, low, rather than none. Standard is sent as `default` (API/CLI spelling), never
priority/fast by accident. Summaries and changelogs allow 2,048 output tokens
because the limit includes hidden reasoning; their existing public length and
prompt constraints remain unchanged. Category inference uses no reasoning.

## API and evaluator compatibility

Application text/structured requests use Responses. Codex uses Responses,
including native tool calls; Sol tool calls must not be translated to Chat.
The evaluation broker rejects a Sol Chat request containing tool definitions.
The pinned SkillEvaluator v0.5.0 judge makes tool-free Chat requests. The broker
normalizes legacy `max_tokens` to `max_completion_tokens` for modern reasoning
families and preserves an explicit native limit. Responses limits and native
tool schemas pass through unchanged. Compaction is not a generation request
and receives no reasoning parameter.

SkillEvaluator v0.5.0 pins Codex reasoning to high internally and has no judge
effort option. Therefore the trusted broker applies the versioned recipe at the
wire boundary: medium for agent Responses, high for judge Chat. It removes
unsupported judge sampling fields. This is a recipe decision, not an accidental
upstream override. A caller's explicit service tier is preserved.

The new evaluation config key ends with
`model-policy-v2:medium:high:default`; model names, evaluator commit, environment,
and attempts remain part of the key. The old key and original model recipe
remain recognized without new effort/tier injection. Never rewrite historical
rows or interpret old scores as results of the new recipe. Public current-result
lookup still requires the current config key. New current scores require a new
evaluation, not a migration of previous scores. Runtime schema is unchanged.

Plugin classifier identity advances to `plugin-single-category-v8` and search
intent to `search-intent-v3`. Previously reviewed/applied category decisions
remain independent; stale unreviewed generated proposals need fresh preview.
Skill Card recipe hashing includes model, effort and tier; existing hash-less
claim compatibility and activation boundaries are unchanged.

References: [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna),
[Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol).
