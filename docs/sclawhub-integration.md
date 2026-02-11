# SClawHub Security Badge Integration

## Overview

This integration adds optional security badges from [SClawHub](https://sclawhub.com) to ClawHub skill pages. SClawHub is an independent security scanner for OpenClaw skills that provides automated vulnerability analysis and trust scores.

## What is SClawHub?

[SClawHub](https://sclawhub.com) is a community-driven security scanner for OpenClaw skills that uses:
- **Semgrep pattern matching** to detect known security vulnerabilities
- **Claude AI analysis** for context-aware security review  
- **Trust scores (0-100)** to quickly assess skill safety
- **Detailed reports** with findings and recommendations

The service is:
- ✅ **100% free** and open source ([GitHub](https://github.com/mladjan/Sclawhub))
- ✅ **Transparent** - all scan methodologies are public
- ✅ **Non-blocking** - skills work without SClawHub scans
- ✅ **Complementary** to VirusTotal - adds AI-powered analysis

## How It Works

### 1. Non-Intrusive Integration

The `SClawHubBadge` component:
- Makes an API request to `https://sclawhub.com/api/skills/{owner}/{slug}`
- If the skill has been scanned, displays a trust score badge
- If not scanned or request fails, shows nothing (no error state)
- Badge links to full security report on sclawhub.com

### 2. Trust Score Display

Trust scores are color-coded for quick assessment:

| Score | Emoji | Color | Meaning |
|-------|-------|-------|---------|
| 90-100 | 🛡️ | Green | Excellent security |
| 70-89 | ✅ | Light Green | Good, minor concerns |
| 50-69 | ⚠️ | Yellow | Moderate risk, review needed |
| 30-49 | ⚠️ | Orange | High risk, multiple issues |
| 0-29 | 🚨 | Red | Critical risk |

### 3. User Flow

1. User views a skill on ClawHub
2. If skill has been scanned on SClawHub, badge appears with trust score
3. Clicking badge opens detailed report on sclawhub.com
4. Report shows:
   - Trust score explanation
   - Vulnerability findings
   - Severity classifications
   - Remediation recommendations

## Implementation Details

### Component: `SClawHubBadge.tsx`

```tsx
<SClawHubBadge 
  skill={skill} 
  ownerHandle={ownerHandle} 
  variant="full" // or "compact"
/>
```

**Props:**
- `skill` - PublicSkill object
- `ownerHandle` - Owner's handle or user ID
- `variant` - "full" (detailed) or "compact" (minimal)

**Variants:**

**Full** (used in skill detail page):
```
🛡️ Security: 95/100 → View Report
```

**Compact** (suitable for skill cards):
```
🛡️ 95/100
```

### Integration Points

Currently integrated in:
- `SkillDetailPage.tsx` - Shows full badge below skill badges

**Potential future integrations:**
- `SkillCard.tsx` - Show compact badge in skill listings
- Search results - Quick trust score visibility

### API Endpoint

**Endpoint:** `GET https://sclawhub.com/api/skills/{owner}/{slug}`

**Response (if scanned):**
```json
{
  "id": "owner/skill-name",
  "trustScore": 95,
  "riskLevel": "minimal",
  "summary": "Excellent security, no concerns detected.",
  "scannedAt": "2026-02-09T12:00:00Z"
}
```

**Response (not scanned):** `404 Not Found`

**Error handling:**
- Network errors: Badge doesn't render
- 404: Badge doesn't render (skill not yet scanned)
- Invalid JSON: Badge doesn't render

### Performance

- **Async loading** - doesn't block page render
- **Graceful degradation** - page works without SClawHub
- **No loading states** - badge only appears when data is ready
- **External API** - no impact on ClawHub infrastructure

### Privacy

- API request includes only public skill information (owner, slug)
- No user tracking or analytics
- Badge click opens sclawhub.com in new tab
- No cookies or persistent storage

## Why This Integration?

### 1. Defense in Depth

- **VirusTotal** scans for malware signatures
- **SClawHub** analyzes code patterns and context
- Together: More comprehensive security coverage

### 2. AI-Powered Analysis

- Understands code intent and context
- Detects obfuscation and evasion techniques  
- Provides human-readable explanations

### 3. Community Transparency

- Open source scanner code
- Public scan reports
- Community can audit and improve

### 4. Developer Friendly

- Non-blocking - skills work without scans
- Clear remediation guidance
- Helps developers improve security

## For Skill Developers

### Getting Your Skill Scanned

1. Visit [sclawhub.com/scan](https://sclawhub.com/scan)
2. Paste your skill URL or code
3. Wait for scan to complete (~30 seconds)
4. Badge automatically appears on ClawHub

### Improving Your Score

- **Remove hardcoded secrets** - Use environment variables
- **Validate network calls** - Document API endpoints
- **Avoid obfuscation** - Clear code scores higher
- **Add security comments** - Explain sensitive operations
- **Review findings** - Address reported vulnerabilities

### False Positives

If you believe a finding is incorrect:
1. Review the detailed report on sclawhub.com
2. Open an issue on [GitHub](https://github.com/mladjan/Sclawhub/issues)
3. Provide context and justification
4. Scanner rules will be updated

## Opt-Out

### As a Developer

Skills are **opt-in** by default. SClawHub only scans:
- Skills explicitly submitted for scanning
- Popular skills (with permission)

To remove your scan:
- Contact: kondormit@gmail.com
- Provide skill slug
- Scan report will be removed within 24h

### As a User

Badge display can be disabled:
- Badges only show if skill has been scanned
- No persistent UI elements if not scanned
- Can be hidden via browser extension/CSS

## Future Enhancements

### Planned Features

- [ ] Compact badges in skill listings
- [ ] Scan status indicators (pending, failed)
- [ ] Historical trust score tracking
- [ ] Automated rescanning on version updates
- [ ] Custom security policies

### Integration Opportunities

- Display in search results
- Filter by trust score
- Sort by security rating
- Badge in VS Code extension

## Maintenance

### Responsibility

- **ClawHub team** - Badge integration, UI
- **SClawHub team** - Scanner, API, reports
- **Community** - Report issues, improve rules

### API Stability

SClawHub API is versioned:
- Current: v1 (implied in `/api/skills/...`)
- Breaking changes will use new version paths
- Deprecation notices via GitHub

### Support

**ClawHub integration issues:**
- Open issue on ClawHub repo
- Tag: `integration:sclawhub`

**SClawHub scanner issues:**
- Open issue on [SClawHub repo](https://github.com/mladjan/Sclawhub/issues)
- Email: kondormit@gmail.com

## Resources

- **SClawHub Website:** https://sclawhub.com
- **GitHub (Open Source):** https://github.com/mladjan/Sclawhub
- **API Documentation:** https://sclawhub.com/api/docs (coming soon)
- **Security Rules:** https://github.com/mladjan/Sclawhub/blob/main/scanner/rules/semgrep-rules.yaml

---

**Note:** SClawHub is an independent project and is not officially affiliated with ClawHub or OpenClaw. It's a community contribution to improve OpenClaw ecosystem security.
