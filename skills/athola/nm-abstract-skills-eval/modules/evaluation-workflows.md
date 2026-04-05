# Evaluation Workflows and Techniques

## Detailed Implementation Steps

### Phase 1: Discovery and Assessment
1. **Run discovery**: Use `skills-auditor --discover` to locate all skills
2. **Initial scan**: Execute `skills-auditor --scan-all` for overview
3. **Identify patterns**: Look for common issues and improvement opportunities
4. **Set baselines**: Establish quality metrics and improvement targets

### Phase 2: Detailed Analysis
1. **Deep analysis**: Use `skill-analyzer --path skill.md --verbose` for complex skills
2. **Token evaluation**: Run `token-estimator -f skill.md` for usage analysis
3. **Compliance checking**: Execute `compliance-checker --skill-path skill.md`
4. **Gap analysis**: Compare against best practices and standards

### Phase 3: Improvement Planning
1. **Generate recommendations**: Use `improvement-suggester --skill-path skill.md --priority high`
2. **Prioritize improvements**: Focus on critical and high-priority items first
3. **Create action plans**: Break improvements into manageable tasks
4. **Schedule implementation**: Plan improvement work in logical phases

### Phase 4: Implementation and Validation
1. **Apply improvements**: Implement changes based on recommendations
2. **Test functionality**: Verify tools and examples work correctly
3. **Validate compliance**: Re-run compliance checks
4. **Measure results**: Compare before/after quality scores

## Advanced Analysis Techniques

### Comparative Analysis
- Benchmark skills against best-in-class examples
- Identify patterns in high-performing skills
- Learn from structural and content differences

### Trend Tracking
- Run periodic audits to monitor quality over time
- Track improvement implementation success rates
- Identify recurring issues and systemic problems

### Gap Analysis
- Identify missing skill categories in your library
- Find opportunities for new skill development
- Balance skill coverage across domains and use cases

### Dependency Mapping
- Understand skill relationships and interactions
- Identify potential circular dependencies
- Optimize skill loading patterns and efficiency
