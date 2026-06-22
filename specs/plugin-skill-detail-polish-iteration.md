# Plugin and skill detail polish

This note preserves the complete UI direction established during the June 2026 detail-page iteration. It records both the final target and superseded experiments so future work does not accidentally revive discarded approaches.

## Working environment

- Work in an isolated worktree based on a fully current `upstream/main`.
- Keep the development server detached from Codex so it survives Codex sessions.
- Use production Convex data; do not seed or depend on the local corpus for this review.
- Review the actual local application in the in-app browser.
- Commit each coherent adjustment set.
- During rapid iteration, avoid repeated format/test loops. Run the complete verification once the requested UI pass is finished.

## Shared detail-page contract

- Skill and plugin detail pages must use the same visual grammar whenever the feature exists on both surfaces.
- Differences are allowed only for resource-specific content or capabilities.
- Keep the general content width aligned with the home page's narrow container while allowing the hero wash to bleed across the viewport.
- Keep interfaces flat: avoid nested card-on-card-on-card compositions.
- Remove temporary red structural debug borders before handoff.
- Remove the site-header bottom border on skill and plugin detail pages.
- Preserve the user's page scroll position when switching detail tabs.

## Hero and taxonomy

- Hide the breadcrumb on detail pages. The earlier 12 px, extra-muted breadcrumb treatment is superseded by hiding it.
- Place taxonomy above the title.
- Show category icon plus category name, not icon-only.
- Support up to three categories, separated by commas.
- Follow categories with a vertical separator and up to five topics.
- Render topics lowercase, prefixed with `#`, and muted.
- Keep category/topic typography compact and muted.
- Use a 36 px desktop detail title with deliberate breathing room below the taxonomy row.
- Render the summary at 14 px, muted/approximately 82% opacity, clamped to two lines.
- Use `Read more`, not `See more`, to expand the hero summary.
- Add a restrained red radial wash inspired by Raycast.
- The wash is decorative only: low contrast, full bleed through the header area, and not fixed during scroll.
- Apply the same wash and summary clamp to plugin detail heroes.
- Plugin heroes should follow the skill composition while retaining plugin-specific metadata and actions.
- The earlier narrow-hero experiment and red wash inside the README/content card are superseded. The hero remains full width within the page composition; content cards stay neutral.

## Installation surface

- Keep the install block in the main column; do not remove the sidebar.
- Keep CLI and Prompt options.
- Use the site's sans font for the CLI/Prompt labels, not monospace.
- Style the segmented control with the same visual grammar as the home page's list/grid switcher.
- Animate the active pill and command change quickly and subtly.
- Moving to Prompt reveals content from the right; moving to CLI reveals it from the left.
- Include a light blur reveal and respect reduced-motion preferences.
- Avoid content flicker during mode changes.
- Keep the install command background consistent with other code surfaces.
- Align the main `Install` divider with the sidebar `Installs` divider, but keep content close to the dividers by using compact bottom spacing rather than adding empty height.

## Sidebar metadata and actions

- Keep the sidebar; on mobile place it immediately after the hero in a compact arrangement rather than after all tab content.
- Move Star and Share to the top of the sidebar.
- Keep Report isolated lower in the sidebar.
- Increase the visual size/readability of the star-count badge.
- Do not duplicate Stars in metadata when the Star action already carries the count.
- Hide Downloads from skill metadata.
- Keep Installs visible.
- Rename `Owner` to `Creator` on skills and plugins.
- Use a 32 px creator/user/org avatar.
- For official creators, show the official icon beside the creator name without wrapping it in an additional badge.
- Group `Last updated` and `Current version` on the same metadata row because they are correlated.
- Keep License near version metadata where available.
- Keep the security audit legible as a confidence/status row.
- Tighten sidebar top alignment so it starts with the corresponding main-column install row.

## Detail tabs and content container

- Keep detail tabs outside the major content card.
- Restore a full baseline beneath the entire tab list, with a stronger active-tab indicator.
- This final direction supersedes the temporary request to remove the tab baseline.
- Skill tabs are `SKILL.md`, `Skill Card`, `Files`, `Compare`, and `Versions` when available.
- Plugin README tabs should be labeled `README.md`, not only `README`.
- Content for each active tab belongs inside one major neutral-contrast container.
- Do not place a red wash inside the tab content container.
- Keep tab navigation horizontally usable on small screens without forcing the whole page to overflow.

## Markdown rendering standard

- Treat author Markdown as content and apply one consistent, high-quality rendering standard. Do not special-case individual creators' formatting mistakes.
- Render body copy and paragraphs at 14 px in the detail Markdown surface.
- Standardize heading scale and spacing.
- Do not render heading bottom borders.
- Do not render Markdown horizontal rules in the README/SKILL content surface.
- Keep spacing after headings deliberate and compact enough that sections feel related.
- Use rounded tables consistent with the product radius.
- Ensure tables, blockquotes, inline code, code blocks, and nested surfaces visibly contrast with the content-card background.
- Avoid unintended horizontal page scroll.
- Plugin README rendering must use the exact same Markdown tokens and component backgrounds as skill `SKILL.md` rendering.
- Broken author-provided image URLs may remain broken content, but the renderer must not distort layout around them.

## Code blocks

- Use a compact header with the language label.
- Keep the code block header short; it should not add unnecessary vertical height.
- Remove the code-block copy action from this surface.
- Provide a wrap toggle in the upper-right only when the code actually overflows horizontally.
- Use one wrap icon in both states; indicate active wrapping with a subtle neutral background.
- Do not show a visible focus ring on the wrap button.
- Switching wrap state may change the block height with a fast, subtle blur reveal, but must not flash/flicker the code.
- Preserve horizontal scrolling when wrapping is off.
- Avoid horizontal scrolling when wrapping is on.

## SKILL.md preview

- Keep long SKILL.md content collapsed by default and bring the cutoff high enough that the page remains scannable (roughly the first meaningful section, historically around 50 source lines).
- Use `Read more`/`Show less` for the preview expansion control.
- Do not use heading rules or `<hr>` as section separators.
- Keep README paragraphs at 14 px.

## Related skills

- Render Related skills compactly in the right sidebar.
- Use the same metadata-heading typography as sidebar labels such as Current version and License.
- Do not add a decorative heading underline unless it is the shared section divider.
- Each related item shows title, creator, short summary, and installs/download signal as available.
- Use a subtle background on item hover.
- Never underline item titles on hover.
- Remove the bottom divider from the last related item.
- Place `More in <Category>` after the list, not in the heading row.
- Center that footer action, include the category icon, and remove its underline.
- Apply the same mobile placement rule as the rest of the sidebar.

## Versions

- Versions are rendered by ClawHub, not by an iframe or VirusTotal embed; therefore the layout is fully controlled by this app.
- Present release history like a changelog rather than a tall nested card stack.
- Keep each release compact and horizontally organized.
- Use an explicit row grid with quiet column headings so scan/audit/tag/action columns stay understandable.
- The collapsed row must keep the important facts visible: version, date, release channel/latest state, package download, scan state, and security review/audit state when available.
- Make the entire release row toggle expansion, except nested links/actions.
- Put a chevron at the far right and rotate it when expanded so collapsibility is unmistakable.
- Expanded content contains the changelog without an extra heavy card or left accent border.
- Give rows and expanded content enough neutral contrast to show grouping without creating cards inside cards.
- Use compact icon-only pass states in dense release rows, and reserve labeled badges for states that need attention such as Review and Pending.
- Highlight the latest/current release subtly through row background and/or a compact badge, not a heavy decorative treatment.
- Remove the old internal scroll region and let the page flow naturally.
- Label the package action `Download .zip` with a muted download icon and correct icon/label spacing.
- Preserve `Latest`, beta/channel, pending/pass/review, scan, and audit indicators when data exists.
- Never hide changelog text merely because a plugin release lacks scan metadata.
- Use the same component and behavior for skill and plugin Versions; omit only unavailable fields. If plugin releases do not expose per-release checks, use that column for package tags instead of showing an empty checks concept.

## Files

- The initial Files view is a full-width file tree only.
- Keep directories grouped and expandable with familiar folder/file icons.
- Always give `SKILL.md` a subtle muted highlight in the tree so the primary artifact is easy to find.
- Clicking a file replaces the tree with a full-width file preview.
- The file preview includes a clear Back control that returns to the tree.
- Do not show a permanent split tree/preview layout.
- Keep file sizes and hashes as secondary metadata.
- Avoid unnecessary nested panels and horizontal overflow.

## Plugin-specific parity

- Plugin categories use commas between category names.
- Apply the official creator icon rule to plugin creators.
- Use the red full-bleed hero wash on plugins.
- Clamp plugin summaries to two lines with the same `Read more` behavior.
- Use the shared install, sidebar, tab, Markdown, code-block, table, Versions, and responsive rules.
- Preserve plugin-only tabs and metadata such as Skills, Configuration, Compatibility, Repository, and Type when those resources exist.

## Superseded experiments retained for context

- A temporary red outline was added around major structural divs to inspect layout; it must not ship.
- Tabs were briefly placed inside a contrast card; final direction keeps tabs outside the card.
- The hero was briefly narrowed to the content width; final direction uses the broader hero composition with a full-bleed wash.
- Red washes were briefly applied to the hero/card interior; final direction limits the wash to the page hero background.
- The tab baseline was briefly removed; final direction restores the full baseline plus active indicator.
- `See more` was tested; final copy is `Read more`.
- A code-block copy icon was tested; final code blocks keep only the conditional wrap toggle.
- Different wrap-state icons were tested; final direction uses one icon plus an active background.

## Completion and verification

- Check desktop and mobile layouts on real skill and plugin detail routes using production Convex data.
- Verify every tab, summary expansion, CLI/Prompt transition, code wrapping, version collapse, download link, related-skill hover, file-tree navigation, and Back action.
- Confirm scroll position is preserved when switching tabs.
- Confirm no debug borders, accidental heading rules, duplicated metadata, fixed wash, or unintended horizontal page scroll remain.
- Run the repository static, unit, type/build, and relevant browser gates only after the iteration is complete, unless the user explicitly narrows verification for the handoff.
- Run pre-handoff review and resolve accepted actionable findings unless the user explicitly opts out.
