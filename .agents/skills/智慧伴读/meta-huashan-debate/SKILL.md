---

name: meta-huashan-debate
description: "Use this meta-skill instead of answering directly when the user wants to stage a structured 4-step book debate (华山论剑) — opponents (named persons + cross-disciplinary experts) attack a quoted passage from a book, the author defends and counterattacks, and a referee rules with a scored verdict. The workflow extracts source text from the user's provided PDF when available (via smart-ocr for scanned PDFs), auto-resolves opponent names to existing persona skills by reading their SKILL.md files from disk (munger-perspective, feynman-perspective, naval-perspective) and distills new ones on demand via huashu-nuwa, drives 4 strict steps (opponent_attack → author_first_defense → author_counterattack → referee_verdict), and produces a clash-by-clash scored verdict. Do not use it for general literature analysis, single-author summaries, or non-debate writing tasks."
kind: meta
meta_priority: 50
always: false
final_text_mode: "step:validate_verdict"
triggers:
  - "书籍辩论"
  - "book debate"
  - "辩论主持人"
  - "作者防守反击"
  - "华山论剑"
provenance:
  origin: opensquilla-user
  license: Apache-2.0
metadata:
  opensquilla:
    risk: low
    capabilities: [filesystem-read]
composition:
  steps:
    - id: intake
      kind: llm_chat
      depends_on: []
      with:
        system: "Extract the debate intake contract. Match the user's language. Be conservative — pick safe defaults rather than asking."
        task: |
          Parse the request into a debate-intake contract.

          Request:
          {{ inputs.user_message | xml_escape | truncate(4000) }}

          Return exactly:
          BOOK_TITLE: <book title in user's language>
          BOOK_AUTHOR: <author name>
          QUOTED_PASSAGE: <the exact quote being debated>
          OPPONENTS: <comma-separated list, at least 2>
          PDF_PATH: <local path to PDF if user attached one, else NONE>
          LANGUAGE: <zh|en|...>

    - id: extract_source
      kind: llm_chat
      depends_on: [intake]
      with:
        system: "Extract the exact quoted passage and any surrounding context from the provided PDF or user input."
        task: |
          Based on the intake contract:
          BOOK_TITLE: {{ outputs.intake.BOOK_TITLE }}
          BOOK_AUTHOR: {{ outputs.intake.BOOK_AUTHOR }}
          QUOTED_PASSAGE: {{ outputs.intake.QUOTED_PASSAGE }}
          PDF_PATH: {{ outputs.intake.PDF_PATH }}

          If PDF_PATH is not NONE, try to read the PDF and locate the passage. If the PDF is a scanned image, use smart-ocr to extract text.
          If PDF_PATH is NONE or cannot be read, use your own knowledge of the book.

          Return:
          SOURCE_TEXT: <the full quoted passage with surrounding context, verbatim>
          SOURCE_CONFIDENCE: <high|medium|low — how confident you are in the source text accuracy>
          PAGE_REF: <page number or section reference if available, else NONE>

    - id: distill_missing
      kind: llm_chat
      depends_on: [intake]
      with:
        system: "Check which opponent persona skills exist on disk, and distill missing ones on demand."
        task: |
          Intake contract says opponents: {{ outputs.intake.OPPONENTS }}

          For each opponent name:
          1. Normalize the name to a skill identifier (e.g. "Charlie Munger" → "munger-perspective", "Richard Feynman" → "feynman-perspective", "Naval Ravikant" → "naval-perspective")
          2. Check if a SKILL.md exists at ~/.agents/skills/<identifier>/SKILL.md
          3. If it exists, note it as available
          4. If it does NOT exist, call huashu-nuwa to distill a new persona skill for this opponent on the fly

          Return:
          AVAILABLE_OPPONENTS: <list of opponents with existing persona skills>
          DISTILLED_OPPONENTS: <list of opponents newly distilled via huashu-nuwa>
          MISSING_OPPONENTS: <list of opponents that could not be resolved>

    - id: opponent_attack
      kind: llm_chat
      depends_on: [extract_source, distill_missing]
      with:
        system: |
          You are a debate moderator. For each opponent, load their persona skill (if available) and generate their attack on the quoted passage.

          The quoted passage is:
          {{ outputs.extract_source.SOURCE_TEXT }}

          Available opponents: {{ outputs.distill_missing.AVAILABLE_OPPONENTS }}
          Distilled opponents: {{ outputs.distill_missing.DISTILLED_OPPONENTS }}

          For each opponent with an available persona skill, activate that skill and let them speak in their own voice.
          For opponents without a persona skill, generate a plausible attack based on their known public views.

          Each opponent should:
          1. State their core disagreement with the passage
          2. Provide specific reasoning from their field of expertise
          3. Point out what they think is wrong, naive, or incomplete

          Output format:
          OPPONENT_1_NAME: <name>
          OPPONENT_1_ATTACK: <full attack text>

          OPPONENT_2_NAME: <name>
          OPPONENT_2_ATTACK: <full attack text>

    - id: author_first_defense
      kind: llm_chat
      depends_on: [opponent_attack]
      with:
        system: "You are the author of the book being debated. Defend your quoted passage against the opponents' attacks. Use the source text and your book's broader arguments."
        task: |
          Your quoted passage:
          {{ outputs.extract_source.SOURCE_TEXT }}

          Opponent attacks:
          {{ steps.opponent_attack.output }}

          Respond to each opponent's attack. For each:
          1. Acknowledge the valid part of their criticism
          2. Explain why your view still holds, using your book's framework
          3. Point out where the opponent may have misunderstood your position

          Output in the same language as the user's request.

    - id: author_counterattack
      kind: llm_chat
      depends_on: [author_first_defense]
      with:
        system: "You are the author. Now launch a systematic counterattack — turn the opponents' own logic against them."
        task: |
          Based on your first defense, now go on the offensive:
          {{ steps.author_first_defense.output }}

          For each opponent:
          1. Find a contradiction in their own position or practice that supports your view
          2. Use their own frameworks/fields against them
          3. Show how your passage survives their criticism and actually strengthens under pressure

          Output in the same language as the user's request.

    - id: referee_verdict
      kind: llm_chat
      depends_on: [author_counterattack]
      with:
        system: "You are a strict debate referee. Your job is to give a fair, scored verdict. Do NOT give everyone a participation trophy. Be honest about who won each clash."
        task: |
          Source passage:
          {{ outputs.extract_source.SOURCE_TEXT }}

          Opponent attacks:
          {{ steps.opponent_attack.output }}

          Author's defense & counterattack:
          {{ steps.author_first_defense.output }}
          {{ steps.author_counterattack.output }}

          Produce a structured verdict with:

          1. CLASH-BY-CLASH ANALYSIS:
             For each opponent vs author exchange:
             - Opponent's strongest point
             - Author's best response
             - Who won this clash (opponent / author / draw)
             - Score (1-10)

          2. FINAL VERDICT:
             - Overall winner: <author / opponents / draw>
             - What the author's view got right (things that survived pressure)
             - What the author's view got wrong or needs to reconsider (things that were weakened)
             - The most important insight from this debate

          3. VERDICT SUMMARY (one paragraph, user's language):
             <clear, honest summary of who won and why>

          Be honest. If an opponent's attack was devastating, say so. If the author's defense was weak, say so.

    - id: validate_verdict
      kind: user_input
      depends_on: [referee_verdict]
      clarify:
        mode: form
        intro: "辩论结束。你对这个裁决满意吗？有什么想补充或调整的？"
        fields:
          - name: feedback
            type: string
            required: false
            prompt: "你的反馈 / Your feedback"
            max_chars: 2000
---

...
