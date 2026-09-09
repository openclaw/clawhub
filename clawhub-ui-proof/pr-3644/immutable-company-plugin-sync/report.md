These screenshots were captured from real running ClawHub instances backed by local Convex fixtures. They are not generated mockups.

Security results use controlled worker fixtures, not live ClawScan provider certification. The company and registry artifacts were downloaded through the public package API and installed with OpenClaw 2026.9.3 in a disposable OCM environment. The environment was removed after validation.

Validated API and installation evidence:

```json
{
  "results": [
    {
      "name": "@cursor/registry-notes",
      "version": "1.0.0",
      "sourceContentHash": "e60ac134a9134a4befc9c58a86588b0bbdcec47bffc68964ba38110a433eed0a",
      "artifactHash": "749839c571b103bfc0c51add7e6f6e66681ca929b38123fd56980b137191c24e",
      "attemptId": "r97529qkw0hzvg85d08g1p2d158e265z",
      "inspectorFindings": [
        {
          "authorRemediation": {
            "docsUrl": "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#manifest-unknown-fields",
            "summary": "Move unsupported top-level manifest fields into supported package metadata or remove them."
          },
          "code": "manifest-unknown-fields",
          "findingKind": "warning",
          "issueClass": "upstream-metadata",
          "level": "warning",
          "message": "registry-notes: manifest uses unsupported top-level fields",
          "severity": "P2",
          "targetOpenClawVersion": "2026.9.3"
        },
        {
          "authorRemediation": {
            "docsUrl": "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#package-json-missing",
            "summary": "Add a package.json to the plugin package."
          },
          "code": "package-json-missing",
          "findingKind": "warning",
          "issueClass": "upstream-metadata",
          "level": "warning",
          "message": "registry-notes: package metadata is missing",
          "severity": "P2",
          "targetOpenClawVersion": "2026.9.3"
        }
      ],
      "ok": true,
      "packageId": "r17793maqqrkkz02rbs0kb96th8e2578",
      "packageName": "@cursor/registry-notes",
      "publicationStatus": "pending",
      "releaseId": "q979x9wms525m7zk430y7xc9j98e2qy4",
      "status": "pending"
    },
    {
      "name": "@cursor/scan-blocked-notes",
      "version": "1.0.0",
      "sourceContentHash": "09dcf3bfbf58f5564d4f48f367c35a97930c37cc33c497f6fd83650ea14f3b2e",
      "artifactHash": "778b40921e3247fb3a80f38b464e26224b99fa4ca78f0b76d1539a631f04cbf8",
      "attemptId": "r97afczgxpf7kfj2e0gztgh7858e3hy0",
      "inspectorFindings": [
        {
          "authorRemediation": {
            "docsUrl": "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#manifest-unknown-fields",
            "summary": "Move unsupported top-level manifest fields into supported package metadata or remove them."
          },
          "code": "manifest-unknown-fields",
          "findingKind": "warning",
          "issueClass": "upstream-metadata",
          "level": "warning",
          "message": "scan-blocked-notes: manifest uses unsupported top-level fields",
          "severity": "P2",
          "targetOpenClawVersion": "2026.9.3"
        },
        {
          "authorRemediation": {
            "docsUrl": "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#package-json-missing",
            "summary": "Add a package.json to the plugin package."
          },
          "code": "package-json-missing",
          "findingKind": "warning",
          "issueClass": "upstream-metadata",
          "level": "warning",
          "message": "scan-blocked-notes: package metadata is missing",
          "severity": "P2",
          "targetOpenClawVersion": "2026.9.3"
        }
      ],
      "ok": true,
      "packageId": "r17a4975nhppez6yhs5hjwy2h58e2x6h",
      "packageName": "@cursor/scan-blocked-notes",
      "publicationStatus": "pending",
      "releaseId": "q97ecfj5jc4t8svv6rvpfdc8fn8e2mme",
      "status": "pending"
    },
    {
      "name": "@fixture-company/company-notes",
      "version": "1.0.0",
      "sourceContentHash": "b4652547e0f4cdd3c4312eb173f2d4c017ec88f43e2c85b6e9c64fc1c4afe1f0",
      "artifactHash": "3071c9ab4bb05ac9689d4784f032a0fafb8ec88c020e34cbc5a3883c7e5e3ffc",
      "attemptId": "r978dfawmeg0w0wk304tqv6b9n8e35s8",
      "inspectorFindings": [
        {
          "authorRemediation": {
            "docsUrl": "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#manifest-unknown-fields",
            "summary": "Move unsupported top-level manifest fields into supported package metadata or remove them."
          },
          "code": "manifest-unknown-fields",
          "findingKind": "warning",
          "issueClass": "upstream-metadata",
          "level": "warning",
          "message": "company-notes: manifest uses unsupported top-level fields",
          "severity": "P2",
          "targetOpenClawVersion": "2026.9.3"
        },
        {
          "authorRemediation": {
            "docsUrl": "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#package-json-missing",
            "summary": "Add a package.json to the plugin package."
          },
          "code": "package-json-missing",
          "findingKind": "warning",
          "issueClass": "upstream-metadata",
          "level": "warning",
          "message": "company-notes: package metadata is missing",
          "severity": "P2",
          "targetOpenClawVersion": "2026.9.3"
        }
      ],
      "ok": true,
      "packageId": "r17anwq8c1meyz8dry6yx1t7md8e3dtr",
      "packageName": "@fixture-company/company-notes",
      "publicationStatus": "pending",
      "releaseId": "q971x88ekwnj10mevf6thgndbx8e27jx",
      "status": "pending"
    }
  ],
  "synchronization": {
    "repeat": [
      {
        "name": "@cursor/registry-notes",
        "status": "unchanged",
        "reason": "These source bytes already have an immutable release",
        "version": "1.0.0"
      },
      {
        "name": "@cursor/scan-blocked-notes",
        "status": "blocked",
        "reason": "These source bytes already have an immutable release",
        "version": "1.0.0"
      },
      {
        "name": "@fixture-company/company-notes",
        "status": "unchanged",
        "reason": "These source bytes already have an immutable release",
        "version": "1.0.0"
      }
    ],
    "update": [
      {
        "name": "@fixture-company/company-notes",
        "status": "update",
        "reason": "Changed source bytes require a new scanned immutable release",
        "version": "1.0.0+clawhub.9c85ed549ffc7ddb"
      }
    ],
    "blocked": [
      {
        "name": "@fixture-company/company-notes",
        "status": "update",
        "reason": "Changed source bytes require a new scanned immutable release",
        "version": "1.0.0+clawhub.fff0cdc14e1e2aea"
      }
    ],
    "replacement": {
      "from": "@cursor/replacement-notes",
      "to": "@fixture-company/replacement-notes",
      "status": 307
    },
    "canonicalCatalog": {
      "items": [
        {
          "categories": [
            "tools"
          ],
          "channel": "official",
          "createdAt": 1788923825124,
          "displayName": "company",
          "family": "bundle-plugin",
          "icon": null,
          "isOfficial": true,
          "latestVersion": "1.0.0",
          "name": "@fixture-company/replacement-notes",
          "ownerHandle": "fixture-company",
          "runtimeId": "replacement-notes",
          "stats": {
            "downloads": 0,
            "installs": 0,
            "stars": 0,
            "versions": 1
          },
          "summary": "@fixture-company/replacement-notes",
          "topics": [],
          "updatedAt": 1788923827127,
          "verificationTier": "source-linked"
        },
        {
          "categories": [
            "tools"
          ],
          "channel": "official",
          "createdAt": 1788923728694,
          "displayName": "company",
          "family": "bundle-plugin",
          "icon": null,
          "isOfficial": true,
          "latestVersion": "1.0.0+clawhub.9c85ed549ffc7ddb",
          "name": "@fixture-company/company-notes",
          "ownerHandle": "fixture-company",
          "runtimeId": "company-notes",
          "stats": {
            "downloads": 0,
            "installs": 0,
            "stars": 0,
            "versions": 2
          },
          "summary": "@fixture-company/company-notes",
          "topics": [],
          "updatedAt": 1788923772742,
          "verificationTier": "source-linked"
        },
        {
          "categories": [
            "tools"
          ],
          "channel": "official",
          "createdAt": 1788923704340,
          "displayName": "registry",
          "family": "bundle-plugin",
          "icon": null,
          "isOfficial": true,
          "latestVersion": "1.0.0",
          "name": "@cursor/registry-notes",
          "ownerHandle": "cursor",
          "runtimeId": "registry-notes",
          "stats": {
            "downloads": 0,
            "installs": 0,
            "stars": 0,
            "versions": 1
          },
          "summary": "@cursor/registry-notes",
          "topics": [],
          "updatedAt": 1788923730846,
          "verificationTier": "source-linked"
        }
      ],
      "nextCursor": null,
      "totalCount": 3
    }
  },
  "catalog": {
    "items": [
      {
        "categories": [
          "tools"
        ],
        "channel": "official",
        "createdAt": 1788923728694,
        "displayName": "company",
        "family": "bundle-plugin",
        "icon": null,
        "isOfficial": true,
        "latestVersion": "1.0.0",
        "name": "@fixture-company/company-notes",
        "ownerHandle": "fixture-company",
        "runtimeId": "company-notes",
        "stats": {
          "downloads": 0,
          "installs": 0,
          "stars": 0,
          "versions": 1
        },
        "summary": "@fixture-company/company-notes",
        "topics": [],
        "updatedAt": 1788923745205,
        "verificationTier": "source-linked"
      },
      {
        "categories": [
          "tools"
        ],
        "channel": "official",
        "createdAt": 1788923704340,
        "displayName": "registry",
        "family": "bundle-plugin",
        "icon": null,
        "isOfficial": true,
        "latestVersion": "1.0.0",
        "name": "@cursor/registry-notes",
        "ownerHandle": "cursor",
        "runtimeId": "registry-notes",
        "stats": {
          "downloads": 0,
          "installs": 0,
          "stars": 0,
          "versions": 1
        },
        "summary": "@cursor/registry-notes",
        "topics": [],
        "updatedAt": 1788923730846,
        "verificationTier": "source-linked"
      }
    ],
    "nextCursor": null,
    "totalCount": 2
  },
  "inventory": {
    "version": 1,
    "snapshots": [
      {
        "repo": "cursor/plugins",
        "repositoryId": 1,
        "ownerId": 10,
        "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "updatedAt": "2026-09-01T00:00:00Z"
      },
      {
        "repo": "fixture-company/plugins",
        "repositoryId": 2,
        "ownerId": 20,
        "commit": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "updatedAt": "2026-09-01T00:00:00Z"
      },
      {
        "repo": "anthropics/claude-plugins-official",
        "repositoryId": 3,
        "ownerId": 30,
        "commit": "3333333333333333333333333333333333333333",
        "updatedAt": "2026-09-01T00:00:00Z"
      },
      {
        "repo": "openai/plugins",
        "repositoryId": 4,
        "ownerId": 40,
        "commit": "4444444444444444444444444444444444444444",
        "updatedAt": "2026-09-01T00:00:00Z"
      }
    ],
    "candidates": [
      {
        "name": "company",
        "repo": "anthropics/claude-plugins-official",
        "path": "company",
        "registry": "claude",
        "categories": [
          "tools"
        ],
        "capabilities": {
          "runnable": [
            "skills"
          ],
          "omitted": []
        },
        "status": "superseded",
        "reasons": [
          "Same integration and primary job"
        ],
        "integration": "company",
        "job": "notes",
        "publisher": "anthropic",
        "authorship": "registry",
        "ownershipEvidence": "https://example.com/fixture-company",
        "commit": "3333333333333333333333333333333333333333",
        "sourceUrl": "https://github.com/anthropics/claude-plugins-official/tree/3333333333333333333333333333333333333333/company",
        "format": "claude",
        "upstreamVersion": "1.0.0",
        "license": {
          "status": "eligible",
          "reasons": [],
          "files": [
            {
              "path": "company/LICENSE",
              "sha256": "14293556b79940745123d0160c71d27ed0e9fe9b8a848093f3ed78f4853caafe",
              "text": "MIT License\n\nCopyright (c) 2026 Peter Steinberger\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n"
            }
          ],
          "notices": []
        },
        "contentHash": "716a8be91e3ea240bab355a516a33959df8a1848979edc6a3e07ba30681b90e2",
        "canonical": "fixture-company/plugins#company"
      },
      {
        "name": "company",
        "repo": "cursor/plugins",
        "path": "company",
        "registry": "cursor",
        "categories": [
          "tools"
        ],
        "capabilities": {
          "runnable": [
            "skills"
          ],
          "omitted": [
            "rules"
          ]
        },
        "status": "superseded",
        "reasons": [
          "Same integration and primary job"
        ],
        "integration": "company",
        "job": "notes",
        "publisher": "cursor",
        "authorship": "registry",
        "ownershipEvidence": "https://example.com/fixture-company",
        "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "sourceUrl": "https://github.com/cursor/plugins/tree/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/company",
        "format": "cursor",
        "declaredAuthor": {
          "name": "Cursor"
        },
        "description": "Local catalog integration acceptance fixture",
        "upstreamVersion": "1.0.0",
        "license": {
          "status": "eligible",
          "reasons": [],
          "files": [
            {
              "path": "company/LICENSE",
              "sha256": "14293556b79940745123d0160c71d27ed0e9fe9b8a848093f3ed78f4853caafe",
              "text": "MIT License\n\nCopyright (c) 2026 Peter Steinberger\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n"
            }
          ],
          "notices": []
        },
        "contentHash": "8b007966d592ac63b0a632f6da056bcd8d986419b4f0329765e65ee73daa48c8",
        "canonical": "fixture-company/plugins#company"
      },
      {
        "name": "registry",
        "repo": "cursor/plugins",
        "path": "registry",
        "registry": "cursor",
        "categories": [
          "tools"
        ],
        "capabilities": {
          "runnable": [
            "skills"
          ],
          "omitted": [
            "rules"
          ]
        },
        "status": "selected",
        "reasons": [
          "Canonical source selected by provenance, runnable coverage and maintenance"
        ],
        "integration": "registry",
        "job": "notes",
        "publisher": "cursor",
        "authorship": "registry",
        "ownershipEvidence": "https://example.com/fixture-company",
        "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "sourceUrl": "https://github.com/cursor/plugins/tree/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/registry",
        "format": "cursor",
        "declaredAuthor": {
          "name": "Cursor"
        },
        "description": "Local catalog integration acceptance fixture",
        "upstreamVersion": "1.0.0",
        "license": {
          "status": "eligible",
          "reasons": [],
          "files": [
            {
              "path": "registry/LICENSE",
              "sha256": "14293556b79940745123d0160c71d27ed0e9fe9b8a848093f3ed78f4853caafe",
              "text": "MIT License\n\nCopyright (c) 2026 Peter Steinberger\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n"
            }
          ],
          "notices": []
        },
        "contentHash": "e60ac134a9134a4befc9c58a86588b0bbdcec47bffc68964ba38110a433eed0a"
      },
      {
        "name": "scan-blocked",
        "repo": "cursor/plugins",
        "path": "scan-blocked",
        "registry": "cursor",
        "categories": [
          "tools"
        ],
        "capabilities": {
          "runnable": [
            "skills"
          ],
          "omitted": [
            "rules"
          ]
        },
        "status": "selected",
        "reasons": [
          "Canonical source selected by provenance, runnable coverage and maintenance"
        ],
        "integration": "scan-blocked",
        "job": "notes",
        "publisher": "cursor",
        "authorship": "registry",
        "ownershipEvidence": "https://example.com/fixture-company",
        "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "sourceUrl": "https://github.com/cursor/plugins/tree/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/scan-blocked",
        "format": "cursor",
        "declaredAuthor": {
          "name": "Cursor"
        },
        "description": "Local catalog integration acceptance fixture",
        "upstreamVersion": "1.0.0",
        "license": {
          "status": "eligible",
          "reasons": [],
          "files": [
            {
              "path": "scan-blocked/LICENSE",
              "sha256": "14293556b79940745123d0160c71d27ed0e9fe9b8a848093f3ed78f4853caafe",
              "text": "MIT License\n\nCopyright (c) 2026 Peter Steinberger\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n"
            }
          ],
          "notices": []
        },
        "contentHash": "09dcf3bfbf58f5564d4f48f367c35a97930c37cc33c497f6fd83650ea14f3b2e"
      },
      {
        "name": "slack",
        "repo": "cursor/plugins",
        "path": "slack",
        "registry": "cursor",
        "categories": [
          "tools"
        ],
        "capabilities": {
          "runnable": [
            "skills"
          ],
          "omitted": [
            "rules"
          ]
        },
        "status": "existing-openclaw",
        "reasons": [
          "Equivalent OpenClaw integration has precedence"
        ],
        "integration": "slack",
        "job": "notes",
        "publisher": "cursor",
        "authorship": "registry",
        "ownershipEvidence": "https://example.com/fixture-company",
        "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "sourceUrl": "https://github.com/cursor/plugins/tree/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/slack",
        "format": "cursor",
        "declaredAuthor": {
          "name": "Cursor"
        },
        "description": "Local catalog integration acceptance fixture",
        "upstreamVersion": "1.0.0",
        "license": {
          "status": "eligible",
          "reasons": [],
          "files": [
            {
              "path": "slack/LICENSE",
              "sha256": "14293556b79940745123d0160c71d27ed0e9fe9b8a848093f3ed78f4853caafe",
              "text": "MIT License\n\nCopyright (c) 2026 Peter Steinberger\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n"
            }
          ],
          "notices": []
        },
        "contentHash": "8d494ed43b8175c6f3bd61f7fc55961c96cad28ed6ffeb5be6e50ea5ef227426",
        "canonical": "slack"
      },
      {
        "name": "unlicensed",
        "repo": "cursor/plugins",
        "path": "unlicensed",
        "registry": "cursor",
        "categories": [
          "tools"
        ],
        "capabilities": {
          "runnable": [
            "skills"
          ],
          "omitted": [
            "rules"
          ]
        },
        "status": "blocked",
        "reasons": [
          "No applicable MIT license: unlicensed/.cursor-plugin/plugin.json",
          "No applicable MIT license: unlicensed/skills/notes/SKILL.md",
          "No applicable MIT license: unlicensed/rules/ignored.mdc"
        ],
        "integration": "unlicensed",
        "job": "notes",
        "publisher": "cursor",
        "authorship": "registry",
        "ownershipEvidence": "https://example.com/fixture-company",
        "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "sourceUrl": "https://github.com/cursor/plugins/tree/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/unlicensed",
        "format": "cursor",
        "declaredAuthor": {
          "name": "Cursor"
        },
        "description": "Local catalog integration acceptance fixture",
        "upstreamVersion": "1.0.0",
        "license": {
          "status": "blocked",
          "reasons": [
            "No applicable MIT license: unlicensed/.cursor-plugin/plugin.json",
            "No applicable MIT license: unlicensed/skills/notes/SKILL.md",
            "No applicable MIT license: unlicensed/rules/ignored.mdc"
          ],
          "files": [],
          "notices": []
        },
        "contentHash": "ceb433488b6f9ce616b522fb057773459cb1a4e88c3b4b63a1af4180ef2aa6b5"
      },
      {
        "name": "company",
        "repo": "fixture-company/plugins",
        "path": "company",
        "registry": "cursor",
        "categories": [
          "tools"
        ],
        "capabilities": {
          "runnable": [
            "skills"
          ],
          "omitted": [
            "rules"
          ]
        },
        "status": "selected",
        "reasons": [
          "Canonical source selected by provenance, runnable coverage and maintenance"
        ],
        "integration": "company",
        "job": "notes",
        "publisher": "fixture-company",
        "authorship": "company",
        "ownershipEvidence": "https://example.com/fixture-company",
        "commit": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "sourceUrl": "https://github.com/fixture-company/plugins/tree/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/company",
        "format": "cursor",
        "declaredAuthor": {
          "name": "Fixture Company"
        },
        "description": "Local catalog integration acceptance fixture",
        "upstreamVersion": "1.0.0",
        "license": {
          "status": "eligible",
          "reasons": [],
          "files": [
            {
              "path": "company/LICENSE",
              "sha256": "14293556b79940745123d0160c71d27ed0e9fe9b8a848093f3ed78f4853caafe",
              "text": "MIT License\n\nCopyright (c) 2026 Peter Steinberger\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n"
            }
          ],
          "notices": []
        },
        "contentHash": "b4652547e0f4cdd3c4312eb173f2d4c017ec88f43e2c85b6e9c64fc1c4afe1f0"
      },
      {
        "name": "company",
        "repo": "openai/plugins",
        "path": "company",
        "registry": "openai",
        "categories": [
          "tools"
        ],
        "capabilities": {
          "runnable": [
            "skills"
          ],
          "omitted": []
        },
        "status": "superseded",
        "reasons": [
          "Same integration and primary job"
        ],
        "integration": "company",
        "job": "notes",
        "publisher": "openai",
        "authorship": "registry",
        "ownershipEvidence": "https://example.com/fixture-company",
        "commit": "4444444444444444444444444444444444444444",
        "sourceUrl": "https://github.com/openai/plugins/tree/4444444444444444444444444444444444444444/company",
        "format": "codex",
        "upstreamVersion": "1.0.0",
        "license": {
          "status": "eligible",
          "reasons": [],
          "files": [
            {
              "path": "company/LICENSE",
              "sha256": "14293556b79940745123d0160c71d27ed0e9fe9b8a848093f3ed78f4853caafe",
              "text": "MIT License\n\nCopyright (c) 2026 Peter Steinberger\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n"
            }
          ],
          "notices": []
        },
        "contentHash": "d869aafbc5e69a40086af585314974956b7f2be11a8429ed928e2011f8421fb8",
        "canonical": "fixture-company/plugins#company"
      }
    ],
    "parityGaps": [
      {
        "integration": "slack",
        "job": "notes",
        "bundledId": "slack",
        "evidence": "https://github.com/openclaw/openclaw/tree/main/extensions/slack"
      }
    ],
    "permissionNeeded": [
      {
        "repo": "cursor/plugins",
        "path": "unlicensed",
        "reasons": [
          "No applicable MIT license: unlicensed/.cursor-plugin/plugin.json",
          "No applicable MIT license: unlicensed/skills/notes/SKILL.md",
          "No applicable MIT license: unlicensed/rules/ignored.mdc"
        ]
      }
    ]
  },
  "scanner": "Controlled mock results through the real prepublication worker protocol; not a live ClawScan certification",
  "installationOutputs": {
    "@fixture-company-company-notes@1.0.0+clawhub.9c85ed549ffc7ddb-openclaw-install.txt": "Resolving clawhub:@fixture-company/company-notes@1.0.0+clawhub.9c85ed549ffc7ddb\u2026\n  Package   @fixture-company/company-notes@1.0.0+clawhub.9c85ed549ffc7ddb\n  Type      bundle-plugin\n  ClawHub   http://127.0.0.1:4590/plugins/@fixture-company/company-notes\n\u256d\u2500 ClawHub Security Audit \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e\n\u2502 @fixture-company/company-notes@1.0.0+clawhub.9c85ed549ffc7ddb                        \u2502\n\u2502                                                                                      \u2502\n\u2502 Outcome: \u001b[32mSafe\u001b[39m                                                                        \u2502\n\u2502                                                                                      \u2502\n\u2502 Overview:                                                                            \u2502\n\u2502 Mock ClawScan marked the local e2e fixture clean.                                    \u2502\n\u2502                                                                                      \u2502\n\u2502 Details:                                                                             \u2502\n\u2502 http://127.0.0.1:4590/fixture-company/plugins/company-notes/security-audit?version=1.0.0%2Bclawhub.9c85ed549ffc7ddb \u2502\n\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f\nDownloading bundle @fixture-company/company-notes@1.0.0+clawhub.9c85ed549ffc7ddb from ClawHub\u2026\nExtracting /private/tmp/openclaw/openclaw-clawhub-package-6KG2NB/company-notes.zip\u2026\nInstalling to /Users/patrickerichsen/.ocm/envs/claw-723-install-proof/.openclaw/extensions/company-notes\u2026\nInstalled plugin: company-notes\nRestart the gateway to load plugins.\n(node:94703) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.\n(Use `node --trace-warnings ...` to show where the warning was created)\n(node:94765) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.\n(Use `node --trace-warnings ...` to show where the warning was created)\n",
    "@fixture-company-replacement-notes-openclaw-install.txt": "Resolving clawhub:@fixture-company/replacement-notes\u2026\n  Package   @fixture-company/replacement-notes@1.0.0\n  Type      bundle-plugin\n  ClawHub   http://127.0.0.1:4590/plugins/@fixture-company/replacement-notes\n\u256d\u2500 ClawHub Security Audit \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e\n\u2502 @fixture-company/replacement-notes@1.0.0                                             \u2502\n\u2502                                                                                      \u2502\n\u2502 Outcome: \u001b[32mSafe\u001b[39m                                                                        \u2502\n\u2502                                                                                      \u2502\n\u2502 Overview:                                                                            \u2502\n\u2502 Mock ClawScan marked the local e2e fixture clean.                                    \u2502\n\u2502                                                                                      \u2502\n\u2502 Details:                                                                             \u2502\n\u2502 http://127.0.0.1:4590/fixture-company/plugins/replacement-notes/security-audit?version=1.0.0 \u2502\n\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f\nDownloading bundle @fixture-company/replacement-notes@1.0.0 from ClawHub\u2026\nExtracting /private/tmp/openclaw/openclaw-clawhub-package-LojT72/replacement-notes.zip\u2026\nInstalling to /Users/patrickerichsen/.ocm/envs/claw-723-install-proof/.openclaw/extensions/replacement-notes\u2026\nInstalled plugin: replacement-notes\nRestart the gateway to load plugins.\n(node:94835) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.\n(Use `node --trace-warnings ...` to show where the warning was created)\n(node:94836) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.\n(Use `node --trace-warnings ...` to show where the warning was created)\n",
    "cursor-openclaw-install.txt": "Resolving clawhub:@cursor/registry-notes@1.0.0\u2026\n  Package   @cursor/registry-notes@1.0.0\n  Type      bundle-plugin\n  ClawHub   http://127.0.0.1:4590/plugins/@cursor/registry-notes\n\u256d\u2500 ClawHub Security Audit \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e\n\u2502 @cursor/registry-notes@1.0.0                                                         \u2502\n\u2502                                                                                      \u2502\n\u2502 Outcome: \u001b[32mSafe\u001b[39m                                                                        \u2502\n\u2502                                                                                      \u2502\n\u2502 Overview:                                                                            \u2502\n\u2502 Mock ClawScan marked the local e2e fixture clean.                                    \u2502\n\u2502                                                                                      \u2502\n\u2502 Details:                                                                             \u2502\n\u2502 http://127.0.0.1:4590/cursor/plugins/registry-notes/security-audit?version=1.0.0     \u2502\n\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f\nDownloading bundle @cursor/registry-notes@1.0.0 from ClawHub\u2026\nExtracting /private/tmp/openclaw/openclaw-clawhub-package-ioDOpc/registry-notes.zip\u2026\nInstalling to /Users/patrickerichsen/.ocm/envs/claw-723-install-proof/.openclaw/extensions/registry-notes\u2026\nInstalled plugin: registry-notes\nRestart the gateway to load plugins.\n(node:81056) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.\n(Use `node --trace-warnings ...` to show where the warning was created)\n(node:81057) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.\n(Use `node --trace-warnings ...` to show where the warning was created)\n",
    "fixture-company-openclaw-install.txt": "Resolving clawhub:@fixture-company/company-notes@1.0.0\u2026\n  Package   @fixture-company/company-notes@1.0.0\n  Type      bundle-plugin\n  ClawHub   http://127.0.0.1:4590/plugins/@fixture-company/company-notes\n\u256d\u2500 ClawHub Security Audit \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e\n\u2502 @fixture-company/company-notes@1.0.0                                                 \u2502\n\u2502                                                                                      \u2502\n\u2502 Outcome: \u001b[32mSafe\u001b[39m                                                                        \u2502\n\u2502                                                                                      \u2502\n\u2502 Overview:                                                                            \u2502\n\u2502 Mock ClawScan marked the local e2e fixture clean.                                    \u2502\n\u2502                                                                                      \u2502\n\u2502 Details:                                                                             \u2502\n\u2502 http://127.0.0.1:4590/fixture-company/plugins/company-notes/security-audit?version=1.0.0 \u2502\n\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f\nDownloading bundle @fixture-company/company-notes@1.0.0 from ClawHub\u2026\nExtracting /private/tmp/openclaw/openclaw-clawhub-package-V982Nb/company-notes.zip\u2026\nInstalling to /Users/patrickerichsen/.ocm/envs/claw-723-install-proof/.openclaw/extensions/company-notes\u2026\nInstalled plugin: company-notes\nRestart the gateway to load plugins.\n(node:84267) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.\n(Use `node --trace-warnings ...` to show where the warning was created)\n(node:84268) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.\n(Use `node --trace-warnings ...` to show where the warning was created)\n"
  },
  "validatedCommit": "ad61c852ff",
  "localApp": "http://127.0.0.1:4590",
  "openclawRuntime": "2026.9.3",
  "controlledScannerFixture": true
}
```
