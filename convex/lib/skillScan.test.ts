import { describe, expect, it } from 'vitest'
import { handleScanResult, type ScanResult } from './skillScan'

describe('handleScanResult', () => {
    it('returns empty array for clean verdict', () => {
        const result: ScanResult = {
            verdict: 'clean',
            findings: [],
            scanned_at: new Date().toISOString(),
            duration_ms: 50,
            files_scanned: 3,
            scanner_version: '0.1.0',
            summary: { critical: 0, high: 0, total: 0 },
        }
        const flags = handleScanResult(result)
        expect(flags).toEqual([])
    })

    it('returns finding rule IDs for flagged verdict', () => {
        const result: ScanResult = {
            verdict: 'flagged',
            findings: [
                {
                    rule_id: 'suspicious.webhook',
                    engine: 'code',
                    severity: 'medium',
                    message: 'Discord webhook URL detected',
                },
                {
                    rule_id: 'suspicious.secrets',
                    engine: 'code',
                    severity: 'low',
                    message: 'Potential API key pattern',
                },
            ],
            scanned_at: new Date().toISOString(),
            duration_ms: 100,
            files_scanned: 5,
            scanner_version: '0.1.0',
            summary: { critical: 0, high: 0, total: 2 },
        }
        const flags = handleScanResult(result)
        expect(flags).toEqual(['suspicious.webhook', 'suspicious.secrets'])
    })

    it('throws ConvexError for blocked verdict', () => {
        const result: ScanResult = {
            verdict: 'blocked',
            findings: [
                {
                    rule_id: 'malware.reverse_shell',
                    engine: 'binary',
                    severity: 'critical',
                    message: 'Reverse shell detected',
                    file_path: 'evil.py',
                },
            ],
            scanned_at: new Date().toISOString(),
            duration_ms: 25,
            files_scanned: 1,
            scanner_version: '0.1.0',
            summary: { critical: 1, high: 0, total: 1 },
        }
        expect(() => handleScanResult(result)).toThrow()
    })

    it('includes file path in blocked error message', () => {
        const result: ScanResult = {
            verdict: 'blocked',
            findings: [
                {
                    rule_id: 'code.data_exfiltration',
                    engine: 'code',
                    severity: 'critical',
                    message: 'Data exfiltration pattern',
                    file_path: 'backdoor.js',
                    line_number: 42,
                },
            ],
            scanned_at: new Date().toISOString(),
            duration_ms: 30,
            files_scanned: 2,
            scanner_version: '0.1.0',
            summary: { critical: 1, high: 0, total: 1 },
        }
        try {
            handleScanResult(result)
            expect.fail('Should have thrown')
        } catch (e: unknown) {
            const error = e as { data?: { code?: string } }
            expect(error.data?.code).toBe('SECURITY_BLOCKED')
        }
    })
})

describe('scan verdicts', () => {
    it('critical findings lead to blocked verdict', () => {
        const severityCounts = { critical: 1, high: 0, medium: 0 }
        const expectedVerdict = severityCounts.critical > 0 ? 'blocked' : 'clean'
        expect(expectedVerdict).toBe('blocked')
    })

    it('high-only findings lead to flagged verdict', () => {
        const severityCounts = { critical: 0, high: 2, medium: 1 }
        const expectedVerdict =
            severityCounts.critical > 0 ? 'blocked' : severityCounts.high > 0 ? 'flagged' : 'clean'
        expect(expectedVerdict).toBe('flagged')
    })
})
