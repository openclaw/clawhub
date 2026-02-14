import { describe, expect, it } from 'vitest'
import { __test } from './skillPublish'

describe('skillPublish', () => {
  it('merges github source into metadata', () => {
    const merged = __test.mergeSourceIntoMetadata(
      { clawdis: { emoji: 'x' } },
      {
        kind: 'github',
        url: 'https://github.com/a/b',
        repo: 'a/b',
        ref: 'main',
        commit: '0123456789012345678901234567890123456789',
        path: 'skills/demo',
        importedAt: 123,
      },
    )
    expect((merged as Record<string, unknown>).clawdis).toEqual({ emoji: 'x' })
    const source = (merged as Record<string, unknown>).source
    expect(source).toEqual(
      expect.objectContaining({
        kind: 'github',
        repo: 'a/b',
        path: 'skills/demo',
      }),
    )
  })

  it('rejects thin templated skill content for low-trust publishers', () => {
    const signals = __test.computeQualitySignals({
      readmeText: `---
description: Expert guidance for sushi-rolls.
---
# Sushi Rolls
## Getting Started
- Step-by-step tutorials
- Tips and techniques
- Project ideas
`,
      summary: 'Expert guidance for sushi-rolls.',
    })

    const quality = __test.evaluateQuality({
      signals,
      trustTier: 'low',
      similarRecentCount: 0,
    })

    expect(quality.decision).toBe('reject')
  })

  it('rejects repetitive structural spam bursts', () => {
    const signals = __test.computeQualitySignals({
      readmeText: `# Kitchen Workflow
## Mise en place
- Gather ingredients and check freshness for each item before prep starts.
- Prepare utensils and containers so every step can be executed smoothly.
- Keep notes on ingredient substitutions and expected flavor impact.
## Rolling flow
- Build rolls in small batches, taste often, and adjust seasoning carefully.
- Track timing, texture, and shape consistency to avoid rushed mistakes.
- Capture what worked and what failed so the next run is more reliable.
## Service checklist
- Plate with clear labels, cleaning steps, and handoff instructions.
- Include safety notes, storage guidance, and quality checkpoints.
- Document outcomes and follow-up improvements for the next iteration.
`,
      summary: 'Detailed sushi workflow notes.',
    })

    const quality = __test.evaluateQuality({
      signals,
      trustTier: 'low',
      similarRecentCount: 5,
    })

    expect(quality.decision).toBe('reject')
    expect(quality.reason).toContain('template spam')
  })

  it('does not undercount non-latin skill docs', () => {
    const signals = __test.computeQualitySignals({
      readmeText: `# 飞书图片助手
## 核心能力
- 上传本地图片到飞书并自动返回 image_key，避免重复上传浪费配额。
- 支持群聊与私聊，自动识别目标类型并校验参数，减少调用错误。
- 提供重试与错误分类，方便排查网络问题、权限问题与资源限制。
## 使用说明
先配置应用凭证，然后传入目标会话与文件路径。技能会先检查缓存，再执行上传，并在发送阶段附带日志说明，便于团队追踪。
如果出现失败，输出会包含建议动作，例如补齐权限、检查文件大小、确认机器人是否在群内，以及如何重放请求。
还会记录每一步耗时、返回码与上下文摘要，方便后续做性能分析、告警聚合和批量回放，避免同类问题反复出现。
`,
      summary: '上传并发送图片到飞书，支持缓存、重试和错误诊断。',
    })

    const quality = __test.evaluateQuality({
      signals,
      trustTier: 'low',
      similarRecentCount: 0,
    })

    expect(signals.bodyWords).toBeGreaterThanOrEqual(45)
    expect(quality.decision).toBe('pass')
  })
})
