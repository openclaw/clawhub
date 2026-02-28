/* @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { __test, mapReportToAnalysis } from './oathe'

const { scoreToRating, verdictToStatus, DIMENSION_LABELS } = __test

describe('scoreToRating', () => {
  it('returns ok for scores >= 80', () => {
    expect(scoreToRating(80)).toBe('ok')
    expect(scoreToRating(100)).toBe('ok')
    expect(scoreToRating(95)).toBe('ok')
  })

  it('returns note for scores 50–79', () => {
    expect(scoreToRating(50)).toBe('note')
    expect(scoreToRating(79)).toBe('note')
    expect(scoreToRating(65)).toBe('note')
  })

  it('returns concern for scores 20–49', () => {
    expect(scoreToRating(20)).toBe('concern')
    expect(scoreToRating(49)).toBe('concern')
    expect(scoreToRating(35)).toBe('concern')
  })

  it('returns danger for scores < 20', () => {
    expect(scoreToRating(0)).toBe('danger')
    expect(scoreToRating(19)).toBe('danger')
    expect(scoreToRating(10)).toBe('danger')
  })

  it('handles boundary values exactly', () => {
    expect(scoreToRating(80)).toBe('ok')
    expect(scoreToRating(79)).toBe('note')
    expect(scoreToRating(50)).toBe('note')
    expect(scoreToRating(49)).toBe('concern')
    expect(scoreToRating(20)).toBe('concern')
    expect(scoreToRating(19)).toBe('danger')
  })
})

describe('verdictToStatus', () => {
  it('maps SAFE verdict', () => {
    expect(verdictToStatus('SAFE')).toBe('safe')
    expect(verdictToStatus('safe')).toBe('safe')
    expect(verdictToStatus('Safe')).toBe('safe')
  })

  it('maps CAUTION verdict', () => {
    expect(verdictToStatus('CAUTION')).toBe('caution')
    expect(verdictToStatus('caution')).toBe('caution')
  })

  it('maps DANGEROUS verdict', () => {
    expect(verdictToStatus('DANGEROUS')).toBe('dangerous')
    expect(verdictToStatus('dangerous')).toBe('dangerous')
  })

  it('maps MALICIOUS verdict', () => {
    expect(verdictToStatus('MALICIOUS')).toBe('malicious')
    expect(verdictToStatus('malicious')).toBe('malicious')
  })

  it('returns pending for unknown verdicts', () => {
    expect(verdictToStatus('UNKNOWN')).toBe('pending')
    expect(verdictToStatus('')).toBe('pending')
    expect(verdictToStatus('something-else')).toBe('pending')
  })
})

describe('mapReportToAnalysis', () => {
  const baseReport = {
    audit_id: 'audit-123',
    skill_url: 'https://clawhub.ai/test-skill',
    skill_slug: 'test-skill',
    summary: 'No significant threats detected.',
    recommendation: 'Safe to use.',
    trust_score: 92,
    verdict: 'SAFE',
    category_scores: {
      prompt_injection: {
        score: 95,
        weight: 1,
        findings: [],
      },
      data_exfiltration: {
        score: 88,
        weight: 1,
        findings: ['Minor outbound request detected'],
      },
    },
    findings: [],
  }

  it('maps a complete report to analysis object', () => {
    const result = mapReportToAnalysis(baseReport, 'test-skill')

    expect(result.status).toBe('safe')
    expect(result.score).toBe(92)
    expect(result.verdict).toBe('SAFE')
    expect(result.summary).toBe('No significant threats detected.')
    expect(result.reportUrl).toBe('https://oathe.ai/report/test-skill')
    expect(result.checkedAt).toBeGreaterThan(0)
  })

  it('maps dimensions with correct labels and ratings', () => {
    const result = mapReportToAnalysis(baseReport, 'test-skill')

    expect(result.dimensions).toHaveLength(2)

    const piDim = result.dimensions.find((d) => d.name === 'prompt_injection')
    expect(piDim).toBeDefined()
    expect(piDim!.label).toBe('Prompt Injection')
    expect(piDim!.rating).toBe('ok')
    expect(piDim!.detail).toBe('No issues detected. Score: 95/100')

    const deDim = result.dimensions.find((d) => d.name === 'data_exfiltration')
    expect(deDim).toBeDefined()
    expect(deDim!.label).toBe('Data Exfiltration')
    expect(deDim!.rating).toBe('ok')
    expect(deDim!.detail).toBe('Minor outbound request detected')
  })

  it('uses dimension key as label fallback for unknown dimensions', () => {
    const report = {
      ...baseReport,
      category_scores: {
        custom_dimension: { score: 60, weight: 1, findings: [] },
      },
    }
    const result = mapReportToAnalysis(report, 'test-skill')

    const dim = result.dimensions.find((d) => d.name === 'custom_dimension')
    expect(dim!.label).toBe('custom_dimension')
  })

  it('maps CAUTION verdict correctly', () => {
    const report = { ...baseReport, verdict: 'CAUTION', trust_score: 54 }
    const result = mapReportToAnalysis(report, 'test-skill')

    expect(result.status).toBe('caution')
    expect(result.score).toBe(54)
  })

  it('maps MALICIOUS verdict correctly', () => {
    const report = { ...baseReport, verdict: 'MALICIOUS', trust_score: 12 }
    const result = mapReportToAnalysis(report, 'test-skill')

    expect(result.status).toBe('malicious')
    expect(result.score).toBe(12)
  })

  it('uses first finding as detail when findings exist', () => {
    const report = {
      ...baseReport,
      category_scores: {
        code_execution: {
          score: 30,
          weight: 1,
          findings: ['Subprocess spawned', 'File written to /tmp'],
        },
      },
    }
    const result = mapReportToAnalysis(report, 'test-skill')

    const dim = result.dimensions.find((d) => d.name === 'code_execution')
    expect(dim!.detail).toBe('Subprocess spawned')
    expect(dim!.rating).toBe('concern')
  })
})

describe('DIMENSION_LABELS', () => {
  it('has labels for all standard dimensions', () => {
    expect(DIMENSION_LABELS.prompt_injection).toBe('Prompt Injection')
    expect(DIMENSION_LABELS.data_exfiltration).toBe('Data Exfiltration')
    expect(DIMENSION_LABELS.code_execution).toBe('Code Execution')
    expect(DIMENSION_LABELS.clone_behavior).toBe('Clone Behavior')
    expect(DIMENSION_LABELS.canary_integrity).toBe('Canary Integrity')
    expect(DIMENSION_LABELS.behavioral_reasoning).toBe('Behavioral Reasoning')
  })
})
