# Integration Testing Framework

## Overview

The integration testing framework validates skills work correctly with Claude Agent SDK features, tool integrations, and context management patterns. This module provides detailed testing strategies for validating skill functionality in real-world usage scenarios.

## Testing Categories

### 1. Basic Functionality Testing

**Purpose:** Verify core skill features work as intended

**Test Cases:**
- Skill loads successfully without errors
- Frontmatter metadata is valid and complete
- Required sections are present and accessible
- Progressive disclosure works correctly
- Module references resolve properly

**Validation Methods:**
```python
def test_basic_functionality(skill_path: str) -> FunctionalityResults:
    """Test basic skill loading and structure"""
    results = FunctionalityResults()

    # Test 1: Skill loads without errors
    try:
        content = Path(skill_path).read_text()
        results.loads_successfully = True
    except Exception as e:
        results.errors.append(f"Failed to load: {e}")
        return results

    # Test 2: Frontmatter is valid
    if content.startswith('---\n'):
        results.valid_frontmatter = True

    # Test 3: Required sections present
    required_sections = ['## Overview', '## When to Use']
    for section in required_sections:
        if section in content:
            results.sections_present.append(section)

    return results
```

### 2. Tool Integration Testing

**Purpose:** Verify tool declarations and integrations work correctly

**Test Cases:**
- Tool declarations match actual available tools
- Tool scripts are executable and error-free
- Tool dependencies are properly declared
- Error handling for missing tools
- Tool output formats are valid

**Example Tests:**
```python
def test_tool_integration(skill_path: str) -> ToolIntegrationResults:
    """Test tool compatibility and integration"""
    results = ToolIntegrationResults()

    # Parse skill frontmatter
    frontmatter = parse_frontmatter(skill_path)
    declared_tools = frontmatter.get('tools', [])

    # Test each declared tool
    for tool in declared_tools:
        tool_path = find_tool(tool, skill_path)
        if tool_path and tool_path.exists():
            results.tools_found.append(tool)

            # Test tool is executable
            if os.access(tool_path, os.X_OK):
                results.tools_executable.append(tool)

            # Test tool runs with --help
            try:
                subprocess.run([tool_path, '--help'],
                              capture_output=True,
                              timeout=5)
                results.tools_functional.append(tool)
            except Exception as e:
                results.tool_errors.append(f"{tool}: {e}")
        else:
            results.tools_missing.append(tool)

    return results
```

### 3. Context Management Testing

**Purpose:** Verify context optimization and efficiency

**Test Cases:**
- Token usage stays within declared limits
- Progressive disclosure reduces initial context
- Module references don't cause circular dependencies
- Context compression works effectively
- Lazy loading patterns function correctly

**Metrics:**
```python
def test_context_management(skill_path: str) -> ContextResults:
    """Test context optimization and efficiency"""
    results = ContextResults()

    content = Path(skill_path).read_text()
    frontmatter = parse_frontmatter(content)

    # Test 1: Token usage
    estimated_tokens = len(content) // 4
    declared_tokens = frontmatter.get('estimated_tokens', 0)

    results.estimated_tokens = estimated_tokens
    results.declared_tokens = declared_tokens
    results.token_accuracy = abs(estimated_tokens - declared_tokens) / estimated_tokens

    # Test 2: Progressive disclosure
    if '## Overview' in content and 'modules/' in content.lower():
        results.has_progressive_disclosure = True

    # Test 3: Module references
    module_refs = re.findall(r'modules/([a-z-]+\.md)', content, re.IGNORECASE)
    results.module_references = module_refs

    return results
```

### 4. Claude SDK API Compliance

**Purpose:** validate compatibility with Claude Agent SDK standards

**Test Cases:**
- Metadata follows SDK specifications
- Tool declarations use correct format
- Usage patterns are properly declared
- Dependencies are correctly specified
- Version compatibility is indicated

**Compliance Checks:**
```python
def test_sdk_compliance(skill_path: str) -> ComplianceResults:
    """Test Claude SDK API compliance"""
    results = ComplianceResults()

    frontmatter = parse_frontmatter(skill_path)

    # Required SDK fields
    required_fields = ['name', 'description', 'version', 'category']
    for field in required_fields:
        if field in frontmatter:
            results.required_fields_present.append(field)
        else:
            results.missing_fields.append(field)

    # Recommended SDK fields (2024 standards)
    recommended_fields = ['provides', 'estimated_tokens', 'usage_patterns']
    for field in recommended_fields:
        if field in frontmatter:
            results.recommended_fields_present.append(field)

    # Check for SDK compatibility declaration
    if 'sdk_features' in frontmatter.get('provides', {}):
        results.sdk_compatible = True

    return results
```

## Integration Test Suite

### Complete Test Runner

```python
class IntegrationTester:
    """detailed integration testing for Claude Skills"""

    def test_skill_integration(self, skill_path: str) -> IntegrationTestResults:
        """Run complete integration test suite"""
        results = IntegrationTestResults()

        # Run all test categories
        results.basic_functionality = self.test_basic_functionality(skill_path)
        results.tool_integration = self.test_tool_compatibility(skill_path)
        results.context_handling = self.test_context_optimization(skill_path)
        results.api_compliance = self.test_sdk_compliance(skill_path)

        # Calculate overall score
        results.overall_score = self._calculate_overall_score(results)

        # Generate recommendations
        results.recommendations = self._generate_recommendations(results)

        return results

    def _calculate_overall_score(self, results: IntegrationTestResults) -> float:
        """Calculate weighted overall integration score"""
        scores = {
            'functionality': self._score_functionality(results.basic_functionality) * 0.25,
            'tools': self._score_tool_integration(results.tool_integration) * 0.25,
            'context': self._score_context_handling(results.context_handling) * 0.25,
            'compliance': self._score_compliance(results.api_compliance) * 0.25
        }
        return sum(scores.values())
```

## Running Integration Tests

### Command-Line Usage

```bash
# Run complete integration test suite
./scripts/integration-tester --skill-path path/to/skill/SKILL.md

# Test specific categories
./scripts/integration-tester --skill-path path/to/skill/SKILL.md \
  --tests functionality,tools,context

# Generate detailed report
./scripts/integration-tester --skill-path path/to/skill/SKILL.md \
  --format markdown --output results.md

# Batch test all skills
./scripts/integration-tester --scan-all --format table
```

### Integration with CI/CD

```yaml
# .github/workflows/skill-integration-tests.yml
name: Skill Integration Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Integration Tests
        run: |
          cd skills/skills-eval
          ./scripts/integration-tester --scan-all --format json > results.json
      - name: Upload Results
        uses: actions/upload-artifact@v3
        with:
          name: integration-test-results
          path: results.json
```

## Best Practices

### 1. Test Coverage

- **detailed:** Test all declared features and tools
- **Realistic:** Use real-world usage scenarios
- **Automated:** Integrate tests into development workflow
- **Continuous:** Run tests on every skill update

### 2. Test Data

- **Valid Skills:** Test with well-formed skills first
- **Edge Cases:** Test with missing fields, broken tools, etc.
- **Performance:** Test with large skills (token limits)
- **Compatibility:** Test across different skill versions

### 3. Result Interpretation

**Scoring Guidelines:**
- **91-100:** Excellent integration, production-ready
- **76-90:** Good integration, minor improvements needed
- **51-75:** Acceptable, several issues to address
- **Below 50:** Significant integration problems

### 4. Continuous Improvement

- Track test results over time
- Identify common failure patterns
- Update tests for new SDK features
- Maintain test documentation

## Advanced Testing Patterns

### Subagent-Based Testing

Use Claude Code subagents for specialized testing:

```python
def test_with_specialist_agents(skill_path: str) -> Dict:
    """Deploy specialist subagents for detailed testing"""
    specialists = {
        "performance": "agents-network-engineer",
        "debugging": "superpowers:systematic-debugging",
        "documentation": "elements-of-style:writing-clearly-and-concisely"
    }

    results = {}
    for specialty, agent in specialists.items():
        results[specialty] = deploy_agent_test(agent, skill_path)

    return results
```

### Performance Testing

```python
def test_performance_characteristics(skill_path: str) -> PerformanceResults:
    """Test skill performance under load"""
    results = PerformanceResults()

    # Load time testing
    start = time.time()
    load_skill(skill_path)
    results.load_time = time.time() - start

    # Memory usage
    results.memory_usage = measure_memory_usage(skill_path)

    # Token efficiency
    results.token_efficiency = calculate_token_efficiency(skill_path)

    return results
```
