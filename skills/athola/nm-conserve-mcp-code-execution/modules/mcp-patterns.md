---
name: mcp-patterns
description: Apply Model Context Protocol patterns for tool chain transformation
  and efficient code execution.
location: plugin
token_budget: 200  # Optimized pattern application
progressive_loading: true
dependencies:
  hub: [mcp-code-execution]
  modules: []
---
# MCP Patterns Module
## Quick Start
Transform tool chains into MCP code execution patterns
for optimized token savings.

## When to Use
- **Automatic**: Keywords: `pattern`, `transform`, `optimize`, `code execution`
- **Tool Chains**: Multiple sequential tool operations
- **Performance Issues**: Slow response times due to tool overhead
- **Token Efficiency**: Need to reduce intermediate context accumulation

## Tool Reference
All patterns use the standard `tools/extracted_tool.py` interface:

```bash
# Basic usage
python tools/extracted_tool.py --input data.json --output results.json

# Advanced options
python tools/extracted_tool.py --input data.json --verbose --output results.json
```

## Required TodoWrite Items
1. `mcp-patterns:identify-tool-chains`
2. `mcp-patterns:apply-transformations`
3. `mcp-patterns:optimize-execution`
4. `mcp-patterns:validate-efficiency`
## Core MCP Patterns
### Before: Tool Chain (High Cost)
```python
# Multiple tool calls, each adds context
data = fetch_database_data()      # +5k tokens
filtered = filter_records(data)   # +3k tokens
transformed = standardize(data)   # +4k tokens
analyzed = calculate_insights(data) # +6k tokens
# Total: 18k+ tokens in intermediate results
```

### After: MCP Code Execution (95% Savings)
```python
# Single execution, minimal context
with mcp_code_execution() as exec:
    result = exec.process_pipeline(data, [
        ('fetch', fetch_database_data),
        ('filter', filter_records),
        ('transform', standardize),
        ('analyze', calculate_insights)
    ])
# Total: ~750 tokens (95% reduction)
```
## Step 1 – Identify Tool Chains (`mcp-patterns:identify-tool-chains`)
### Pattern Detection
Uses the standard tool interface (see Tool Reference above).

### Conversion Triggers
- **High Impact**: >3 tool chains, >10k records, >50KB files
- **Medium Impact**: 2-3 tools, 1-10k records, 10-50KB files
- **Low Impact**: Single operations, <1k records, <10KB files
## Step 2 – Apply Transformations (`mcp-patterns:apply-transformations`)
### Transformation Templates

#### Data Processing Pipeline
Uses the standard tool interface (see Tool Reference above).

#### Analysis Workflow
Uses the standard tool interface (see Tool Reference above).

#### Report Generation
Uses the standard tool interface (see Tool Reference above).

### Progressive Tool Loading
Uses the standard tool interface (see Tool Reference above).
## Step 3 – Optimize Execution (`mcp-patterns:optimize-execution`)
### Execution Optimization Patterns

#### Source-Side Filtering
Uses the standard tool interface (see Tool Reference above).

#### Batch Processing
Uses the standard tool interface (see Tool Reference above).

#### Context-Aware Execution
Uses the standard tool interface (see Tool Reference above).
## Step 4 – Validate Efficiency (`mcp-patterns:validate-efficiency`)
### Efficiency Metrics
Uses the standard tool interface (see Tool Reference above).

### Success Criteria
- **Token Savings**: >50% for large operations
- **Response Time**: >30% improvement
- **Functionality**: 100% preservation
- **MECW Compliance**: Context usage <50% of total window
## Pattern Library
### Available Patterns
- **Data Processing Pipeline**: Sequential data transformation
- **Analysis Workflow**: Multi-step analysis with progressive loading
- **Report Generation**: Template-based document creation
- **Monitoring Pipeline**: Real-time data processing and alerting

### Anti-Patterns to Avoid
- Simple single-tool operations
- Real-time requirements needing immediate response
- Security contexts requiring full intermediate visibility
- Debugging scenarios requiring step-by-step results

## Success Metrics
- **Pattern Application Rate**: >80% of applicable workflows transformed
- **Token Efficiency**: >70% average token savings
- **MECW Compliance**: 100% of patterns stay under 50% context limit
- **Performance Improvement**: >40% average speed enhancement
