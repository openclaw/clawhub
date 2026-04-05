# Performance Benchmarking Framework

## Overview

The performance benchmarking framework provides detailed analysis of skill performance characteristics, including execution speed, memory usage, token efficiency, and scalability. This enables data-driven optimization decisions and validates skills meet performance standards.

## Benchmarking Categories

### 1. Execution Performance

**Metrics:**
- Load time (skill parsing and initialization)
- Tool execution time
- Response generation time
- End-to-end latency

**Measurement Strategy:**
```python
class ExecutionBenchmark:
    """Benchmark execution performance"""

    def measure_load_time(self, skill_path: str) -> float:
        """Measure skill load time"""
        start = time.perf_counter()
        content = Path(skill_path).read_text()
        frontmatter = parse_frontmatter(content)
        end = time.perf_counter()
        return (end - start) * 1000  # milliseconds

    def measure_tool_execution(self, tool_path: str) -> Dict[str, float]:
        """Measure tool execution time"""
        results = {}

        # Warm-up run
        subprocess.run([tool_path, '--help'], capture_output=True)

        # Benchmark runs
        times = []
        for _ in range(10):
            start = time.perf_counter()
            subprocess.run([tool_path, '--help'], capture_output=True)
            end = time.perf_counter()
            times.append((end - start) * 1000)

        results['mean'] = statistics.mean(times)
        results['median'] = statistics.median(times)
        results['std_dev'] = statistics.stdev(times)
        results['min'] = min(times)
        results['max'] = max(times)

        return results
```

### 2. Memory Usage Profiling

**Metrics:**
- Baseline memory usage
- Peak memory usage during execution
- Memory efficiency ratio
- Memory leak detection

**Profiling Methods:**
```python
class MemoryProfiler:
    """Profile memory usage characteristics"""

    def profile_skill_memory(self, skill_path: str) -> MemoryProfile:
        """detailed memory profiling"""
        import tracemalloc

        profile = MemoryProfile()

        # Start tracking
        tracemalloc.start()
        baseline = tracemalloc.get_traced_memory()[0]

        # Load skill
        content = Path(skill_path).read_text()
        parse_frontmatter(content)

        # Measure peak usage
        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()

        profile.baseline_kb = baseline / 1024
        profile.peak_kb = peak / 1024
        profile.current_kb = current / 1024
        profile.efficiency_ratio = baseline / peak if peak > 0 else 1.0

        return profile

    def check_memory_leaks(self, skill_path: str, iterations: int = 100) -> bool:
        """Detect memory leaks through repeated loading"""
        import gc
        import tracemalloc

        tracemalloc.start()
        initial = tracemalloc.get_traced_memory()[0]

        for _ in range(iterations):
            content = Path(skill_path).read_text()
            parse_frontmatter(content)
            gc.collect()

        final = tracemalloc.get_traced_memory()[0]
        tracemalloc.stop()

        # Memory leak if final usage significantly higher than initial
        leak_threshold = initial * 1.1  # 10% increase
        return final > leak_threshold
```

### 3. Token Efficiency Benchmarking

**Metrics:**
- Tokens per feature ratio
- Context compression effectiveness
- Token reduction potential
- Comparative efficiency scores

**Analysis Methods:**
```python
class TokenEfficiencyBenchmark:
    """Benchmark token usage efficiency"""

    def benchmark_token_efficiency(self, skill_path: str) -> TokenBenchmark:
        """detailed token efficiency analysis"""
        benchmark = TokenBenchmark()

        content = Path(skill_path).read_text()
        frontmatter = parse_frontmatter(content)

        # Calculate base metrics
        benchmark.char_count = len(content)
        benchmark.estimated_tokens = self.estimate_tokens(content)
        benchmark.declared_tokens = frontmatter.get('estimated_tokens', 0)

        # Calculate efficiency ratios
        features = len(frontmatter.get('usage_patterns', []))
        benchmark.tokens_per_feature = (
            benchmark.estimated_tokens / features if features > 0 else 0
        )

        # Compare against targets
        targets = {
            'excellent': 1500,
            'good': 2000,
            'acceptable': 2500
        }
        benchmark.efficiency_category = self._categorize_efficiency(
            benchmark.estimated_tokens,
            targets
        )

        # Calculate optimization potential
        if benchmark.estimated_tokens > targets['good']:
            benchmark.optimization_potential = (
                (benchmark.estimated_tokens - targets['good']) /
                benchmark.estimated_tokens * 100
            )

        return benchmark

    def comparative_benchmark(self, skill_paths: List[str]) -> ComparativeBenchmark:
        """Compare efficiency across multiple skills"""
        results = ComparativeBenchmark()

        for skill_path in skill_paths:
            metrics = self.benchmark_token_efficiency(skill_path)
            results.add_skill(Path(skill_path).stem, metrics)

        # Calculate percentiles
        all_tokens = [m.estimated_tokens for m in results.skill_metrics.values()]
        results.percentile_25 = statistics.quantiles(all_tokens, n=4)[0]
        results.percentile_50 = statistics.median(all_tokens)
        results.percentile_75 = statistics.quantiles(all_tokens, n=4)[2]

        return results
```

### 4. Scalability Testing

**Metrics:**
- Performance under load
- Concurrent execution handling
- Large dataset processing
- Resource utilization patterns

**Test Methods:**
```python
class ScalabilityBenchmark:
    """Test skill scalability characteristics"""

    def test_concurrent_execution(
        self,
        skill_path: str,
        concurrency_levels: List[int]
    ) -> Dict[int, float]:
        """Test performance at different concurrency levels"""
        results = {}

        for level in concurrency_levels:
            with ThreadPoolExecutor(max_workers=level) as executor:
                start = time.perf_counter()
                futures = [
                    executor.submit(self._load_skill, skill_path)
                    for _ in range(level * 10)
                ]
                for future in futures:
                    future.result()
                end = time.perf_counter()

            results[level] = (end - start) * 1000  # milliseconds

        return results

    def test_large_dataset_handling(
        self,
        tool_path: str,
        dataset_sizes: List[int]
    ) -> Dict[int, PerformanceMetrics]:
        """Test tool performance with varying dataset sizes"""
        results = {}

        for size in dataset_sizes:
            test_data = self._generate_test_data(size)
            metrics = PerformanceMetrics()

            start = time.perf_counter()
            result = self._run_tool_with_data(tool_path, test_data)
            end = time.perf_counter()

            metrics.execution_time = (end - start) * 1000
            metrics.throughput = size / (end - start) if (end - start) > 0 else 0
            metrics.dataset_size = size

            results[size] = metrics

        return results
```

## detailed Benchmarking Suite

### Complete Benchmark Runner

```python
class PerformanceBenchmarkSuite:
    """detailed performance benchmarking for Claude Skills"""

    def benchmark_skill(self, skill_path: str) -> BenchmarkResults:
        """Run complete benchmark suite"""
        results = BenchmarkResults(skill_path=skill_path)

        # Execution benchmarks
        exec_bench = ExecutionBenchmark()
        results.load_time = exec_bench.measure_load_time(skill_path)

        # Memory benchmarks
        mem_prof = MemoryProfiler()
        results.memory_profile = mem_prof.profile_skill_memory(skill_path)
        results.has_memory_leak = mem_prof.check_memory_leaks(skill_path)

        # Token efficiency benchmarks
        token_bench = TokenEfficiencyBenchmark()
        results.token_efficiency = token_bench.benchmark_token_efficiency(skill_path)

        # Scalability benchmarks
        scale_bench = ScalabilityBenchmark()
        results.concurrency_performance = scale_bench.test_concurrent_execution(
            skill_path,
            concurrency_levels=[1, 2, 4, 8]
        )

        # Calculate overall performance score
        results.overall_score = self._calculate_performance_score(results)

        # Generate optimization recommendations
        results.recommendations = self._generate_recommendations(results)

        return results

    def _calculate_performance_score(self, results: BenchmarkResults) -> float:
        """Calculate weighted overall performance score"""
        scores = {
            'execution': self._score_execution(results.load_time) * 0.25,
            'memory': self._score_memory(results.memory_profile) * 0.25,
            'token': self._score_token_efficiency(results.token_efficiency) * 0.30,
            'scalability': self._score_scalability(results.concurrency_performance) * 0.20
        }
        return sum(scores.values())

    def _score_execution(self, load_time: float) -> float:
        """Score execution performance (0-100)"""
        # < 10ms = excellent, < 50ms = good, < 100ms = acceptable
        if load_time < 10:
            return 100
        elif load_time < 50:
            return 80 - (load_time - 10) / 40 * 20
        elif load_time < 100:
            return 60 - (load_time - 50) / 50 * 20
        else:
            return max(0, 40 - (load_time - 100) / 100 * 40)
```

## Benchmark Output Formats

### 1. Table Format

```
================================================================================
Performance Benchmark: skills-eval
================================================================================

Execution Performance
  Load Time:                    12.5ms
  Grade:                        A (Excellent)

Memory Usage
  Baseline:                     245 KB
  Peak:                         512 KB
  Efficiency Ratio:             0.48
  Memory Leaks:                 None detected

Token Efficiency
  Estimated Tokens:             1,847
  Category:                     Excellent
  Tokens per Feature:           184.7
  Optimization Potential:       0%

Scalability (concurrent loads)
  1 thread:                     12.5ms
  2 threads:                    18.3ms
  4 threads:                    25.1ms
  8 threads:                    35.7ms
  Scaling Factor:               2.85x

Overall Performance Score: 92/100 (Excellent)
```

### 2. JSON Format

```json
{
  "skill_name": "skills-eval",
  "execution": {
    "load_time_ms": 12.5,
    "grade": "A"
  },
  "memory": {
    "baseline_kb": 245,
    "peak_kb": 512,
    "efficiency_ratio": 0.48,
    "has_leak": false
  },
  "token_efficiency": {
    "estimated_tokens": 1847,
    "category": "excellent",
    "tokens_per_feature": 184.7,
    "optimization_potential": 0
  },
  "scalability": {
    "concurrent_1": 12.5,
    "concurrent_2": 18.3,
    "concurrent_4": 25.1,
    "concurrent_8": 35.7,
    "scaling_factor": 2.85
  },
  "overall_score": 92,
  "recommendations": []
}
```

### 3. Markdown Report

```markdown
# Performance Benchmark Report: skills-eval

**Overall Score:** 92/100 (Excellent)

## Execution Performance

- **Load Time:** 12.5ms
- **Grade:** A (Excellent)
- **Analysis:** Fast loading, well-optimized structure

## Memory Usage

- **Baseline:** 245 KB
- **Peak:** 512 KB
- **Efficiency:** 0.48 (Good)
- **Memory Leaks:** None detected

## Token Efficiency

- **Estimated Tokens:** 1,847
- **Category:** Excellent
- **Tokens per Feature:** 184.7
- **Optimization Potential:** 0%

## Scalability

| Concurrency | Execution Time | Scaling |
|------------|---------------|---------|
| 1 thread   | 12.5ms        | 1.0x    |
| 2 threads  | 18.3ms        | 1.46x   |
| 4 threads  | 25.1ms        | 2.01x   |
| 8 threads  | 35.7ms        | 2.85x   |

**Scaling Factor:** 2.85x (Good)

## Recommendations

- No critical optimizations needed
- Consider caching for repeated operations
- Excellent performance across all metrics
```

## Running Benchmarks

### Command-Line Usage

```bash
# Run complete benchmark suite
./scripts/performance-benchmark --skill-path path/to/skill/SKILL.md

# Specific benchmark categories
./scripts/performance-benchmark --skill-path path/to/skill/SKILL.md \
  --benchmarks execution,memory,tokens

# Generate detailed report
./scripts/performance-benchmark --skill-path path/to/skill/SKILL.md \
  --format markdown --output benchmark-report.md

# Comparative benchmarking
./scripts/performance-benchmark --scan-all --format table --compare
```

### Integration with Monitoring

```python
# Continuous performance monitoring
class PerformanceMonitor:
    """Monitor skill performance over time"""

    def track_performance(self, skill_path: str) -> None:
        """Track and store performance metrics"""
        benchmark = PerformanceBenchmarkSuite()
        results = benchmark.benchmark_skill(skill_path)

        # Store results with timestamp
        self.store_results(results, timestamp=datetime.now())

        # Alert on degradation
        if self.detect_degradation(results):
            self.send_alert(skill_path, results)

    def generate_trend_report(self, skill_path: str, days: int = 30) -> TrendReport:
        """Generate performance trend analysis"""
        historical_data = self.load_historical_data(skill_path, days)
        return self.analyze_trends(historical_data)
```

## Best Practices

### 1. Benchmarking Strategy

- **Baseline First:** Establish performance baseline before optimization
- **Consistent Environment:** Run benchmarks in controlled environment
- **Multiple Runs:** Average results across multiple runs
- **Warm-up:** Include warm-up runs before measurement

### 2. Interpretation

**Performance Grades:**
- **A (90-100):** Excellent performance, production-ready
- **B (75-89):** Good performance, minor optimizations beneficial
- **C (60-74):** Acceptable, optimization recommended
- **D (Below 60):** Poor performance, immediate optimization needed

### 3. Optimization Priorities

1. **Token Efficiency** (30% weight) - Highest ROI
2. **Execution Time** (25% weight) - User experience impact
3. **Memory Usage** (25% weight) - Resource costs
4. **Scalability** (20% weight) - Future-proofing

## Advanced Benchmarking

### Comparative Analysis

```python
def compare_skill_versions(
    original_path: str,
    optimized_path: str
) -> ComparisonResults:
    """Compare performance before/after optimization"""
    suite = PerformanceBenchmarkSuite()

    original = suite.benchmark_skill(original_path)
    optimized = suite.benchmark_skill(optimized_path)

    comparison = ComparisonResults()
    comparison.load_time_improvement = (
        (original.load_time - optimized.load_time) / original.load_time * 100
    )
    comparison.token_reduction = (
        (original.token_efficiency.estimated_tokens -
         optimized.token_efficiency.estimated_tokens) /
        original.token_efficiency.estimated_tokens * 100
    )

    return comparison
```

### Regression Detection

```python
def detect_performance_regression(
    current_results: BenchmarkResults,
    baseline_results: BenchmarkResults,
    threshold: float = 0.10  # 10% degradation threshold
) -> List[str]:
    """Detect performance regressions"""
    regressions = []

    # Check load time regression
    if current_results.load_time > baseline_results.load_time * (1 + threshold):
        regressions.append(
            f"Load time regression: {current_results.load_time}ms vs "
            f"{baseline_results.load_time}ms (baseline)"
        )

    # Check token efficiency regression
    current_tokens = current_results.token_efficiency.estimated_tokens
    baseline_tokens = baseline_results.token_efficiency.estimated_tokens
    if current_tokens > baseline_tokens * (1 + threshold):
        regressions.append(
            f"Token efficiency regression: {current_tokens} vs "
            f"{baseline_tokens} (baseline)"
        )

    return regressions
```
