# Skill Authoring Best Practices

Essential patterns for writing effective Claude Code skills. Covers frontmatter structure, modular decomposition, progressive disclosure, and quality validation.

## Quick Reference

### Structure
- Use clear frontmatter with all required fields
- Follow modular skill patterns
- Keep core skill under 300 lines
- Extract complexity to modules/tools

### Content
- Write actionable, specific guidance
- Include concrete examples
- Add anti-rationalization patterns
- Provide clear exit criteria

### Triggers
- Define specific, isolated triggers
- Avoid body content overlap
- Use precise terminology
- Test trigger activation

### Testing
- Validate with /test-skill
- Check compliance with /skills-eval
- Test anti-rationalization with fresh instances
- Verify progressive loading

### Deployment
- Version skills properly
- Document dependencies
- Add usage examples
- Create deployment checklist

## Common Mistakes

❌ **DON'T**:
- Mix multiple concerns in one skill
- Use vague language ("usually", "try to")
- Embed large code blocks
- Skip testing before deployment

✅ **DO**:
- Follow single responsibility principle
- Use explicit, mandatory language
- Reference external tools
- Test thoroughly with subagents

## See Complete Guide

The comprehensive best practices guide includes:
- Detailed examples of good vs bad patterns
- Complete skill templates
- Anti-pattern catalog
- Migration strategies
- Advanced optimization techniques

See `Skill(abstract:skill-authoring)` for the full authoring guide and templates.
