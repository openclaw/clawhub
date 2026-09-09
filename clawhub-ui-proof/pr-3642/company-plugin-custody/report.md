These screenshots were captured from real running ClawHub instances backed by local Convex fixtures. They are not generated mockups.

Security results use controlled worker fixtures, not live ClawScan provider certification. The company and registry artifacts were downloaded through the public package API and installed with OpenClaw 2026.9.3 in a disposable OCM environment. The environment was removed after validation.

Validated API and installation evidence:

```json
{
  "installationRun": {
    "results": [
      {
        "name": "@cursor/registry-notes",
        "version": "1.0.0",
        "sourceContentHash": "e60ac134a9134a4befc9c58a86588b0bbdcec47bffc68964ba38110a433eed0a",
        "artifactHash": "749839c571b103bfc0c51add7e6f6e66681ca929b38123fd56980b137191c24e",
        "attemptId": "r97bstav10r1a519ks57weaeb58e24e6",
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
        "packageId": "r176f871wd7geymreez2hxb10h8e2984",
        "packageName": "@cursor/registry-notes",
        "publicationStatus": "pending",
        "releaseId": "q974f3b9p0p6b3qpjq9tw85m5s8e2msr",
        "status": "pending"
      },
      {
        "name": "@cursor/scan-blocked-notes",
        "version": "1.0.0",
        "sourceContentHash": "09dcf3bfbf58f5564d4f48f367c35a97930c37cc33c497f6fd83650ea14f3b2e",
        "artifactHash": "778b40921e3247fb3a80f38b464e26224b99fa4ca78f0b76d1539a631f04cbf8",
        "attemptId": "r97dzhznc8a6yv28a16mr7evgd8e3pda",
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
        "packageId": "r171hr1k2x1jav69n479m32esd8e3573",
        "packageName": "@cursor/scan-blocked-notes",
        "publicationStatus": "pending",
        "releaseId": "q971k5t8y9bvexhw9k81aq94zd8e347f",
        "status": "pending"
      },
      {
        "name": "@fixture-company/company-notes",
        "version": "1.0.0",
        "sourceContentHash": "b4652547e0f4cdd3c4312eb173f2d4c017ec88f43e2c85b6e9c64fc1c4afe1f0",
        "artifactHash": "3071c9ab4bb05ac9689d4784f032a0fafb8ec88c020e34cbc5a3883c7e5e3ffc",
        "attemptId": "r97dp8tf9zzxr02kcbdc62ryz18e2az7",
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
        "packageId": "r17decdabkfxn3es1b49jnmfxh8e3a3q",
        "packageName": "@fixture-company/company-notes",
        "publicationStatus": "pending",
        "releaseId": "q971c0t3vjnccn45nvvsqpbz1d8e2qe2",
        "status": "pending"
      }
    ],
    "catalog": {
      "items": [
        {
          "categories": [
            "tools"
          ],
          "channel": "official",
          "createdAt": 1788922429262,
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
          "updatedAt": 1788922448289,
          "verificationTier": "source-linked"
        },
        {
          "categories": [
            "tools"
          ],
          "channel": "official",
          "createdAt": 1788922398477,
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
          "updatedAt": 1788922432008,
          "verificationTier": "source-linked"
        }
      ],
      "nextCursor": null,
      "totalCount": 3
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
        }
      ],
      "candidates": [
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
    "scanner": "Controlled mock results through the real prepublication worker protocol; not a live ClawScan certification"
  },
  "finalUiRun": {
    "results": [
      {
        "name": "@cursor/registry-notes",
        "version": "1.0.0",
        "sourceContentHash": "e60ac134a9134a4befc9c58a86588b0bbdcec47bffc68964ba38110a433eed0a",
        "artifactHash": "749839c571b103bfc0c51add7e6f6e66681ca929b38123fd56980b137191c24e",
        "attemptId": "r971pcj3v9m6qha0k9a32nhrrh8e3x1m",
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
        "packageId": "r17cpyth11qjgj09n7xn2tzhpx8e3kg2",
        "packageName": "@cursor/registry-notes",
        "publicationStatus": "pending",
        "releaseId": "q971s70asvrdsysmj7rp22snv18e3fzq",
        "status": "pending"
      },
      {
        "name": "@cursor/scan-blocked-notes",
        "version": "1.0.0",
        "sourceContentHash": "09dcf3bfbf58f5564d4f48f367c35a97930c37cc33c497f6fd83650ea14f3b2e",
        "artifactHash": "778b40921e3247fb3a80f38b464e26224b99fa4ca78f0b76d1539a631f04cbf8",
        "attemptId": "r97f012x38t884qew23w66kvd98e338m",
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
        "packageId": "r17c5t69cqr4ez1cwvsj6bxxbd8e2eae",
        "packageName": "@cursor/scan-blocked-notes",
        "publicationStatus": "pending",
        "releaseId": "q97eadvf5s1d5k3rc4brc23ha98e24xh",
        "status": "pending"
      },
      {
        "name": "@fixture-company/company-notes",
        "version": "1.0.0",
        "sourceContentHash": "b4652547e0f4cdd3c4312eb173f2d4c017ec88f43e2c85b6e9c64fc1c4afe1f0",
        "artifactHash": "3071c9ab4bb05ac9689d4784f032a0fafb8ec88c020e34cbc5a3883c7e5e3ffc",
        "attemptId": "r97ezt5d7zsm3xe1f3vkx3p0en8e2qh8",
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
        "packageId": "r17br8nwyzb6gjmj8ht2ge6hws8e3ecg",
        "packageName": "@fixture-company/company-notes",
        "publicationStatus": "pending",
        "releaseId": "q976sataa1r3m9q2mkzyjwqqvh8e2v89",
        "status": "pending"
      }
    ],
    "catalog": {
      "items": [
        {
          "categories": [
            "tools"
          ],
          "channel": "official",
          "createdAt": 1788922908785,
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
          "updatedAt": 1788922919769,
          "verificationTier": "source-linked"
        },
        {
          "categories": [
            "tools"
          ],
          "channel": "official",
          "createdAt": 1788922870736,
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
          "updatedAt": 1788922911162,
          "verificationTier": "source-linked"
        }
      ],
      "nextCursor": null,
      "totalCount": 3
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
        }
      ],
      "candidates": [
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
    "scanner": "Controlled mock results through the real prepublication worker protocol; not a live ClawScan certification"
  },
  "finalUiUrl": "http://127.0.0.1:4490/fixture-company/plugins/company-notes"
}
```
