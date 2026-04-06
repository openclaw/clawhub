---
name: architecture-paradigm-client-server
description: |
  Client-server architecture for web/mobile apps with centralized services and API design
version: 1.8.1
triggers:
  - architecture
  - client-server
  - peer-to-peer
  - distributed-systems
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/archetypes", "emoji": "\ud83c\udfd7\ufe0f"}}
source: claude-night-market
source_plugin: archetypes
---

> **Night Market Skill** — ported from [claude-night-market/archetypes](https://github.com/athola/claude-night-market/tree/master/plugins/archetypes). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# The Client-Server and Peer-to-Peer Paradigms

## When to Employ This Paradigm
- For traditional applications that have centralized services, such as web or mobile clients communicating with backend APIs.
- For systems exploring decentralized or "offline-first" capabilities that rely on peer-to-peer synchronization.
- To formally document trust boundaries, client-server version negotiation, and API evolution strategies.

## Adoption Steps
1. **Define Responsibilities**: Clearly delineate which logic and data reside on the client versus the server, with the goal of minimizing duplication.
2. **Document the Contracts**: Formally document all APIs, data schemas, authentication flows, and any capability negotiation required for handling different client versions.
3. **Plan for Version Skew**: Implement a strategy to manage different client and server versions, such as using feature flags, `Accept` headers for content negotiation, or semantic versioning for APIs.
4. **Address Connectivity Issues**: If the application is not purely client-server, design for intermittent connectivity. This may involve implementing offline caching, data synchronization protocols, or peer discovery and membership services.
5. **Secure All Communications**: Enforce the use of TLS for all data in transit. Implement authorization policies, rate limiting, and detailed telemetry for every endpoint.

## Key Deliverables
- An Architecture Decision Record (ADR) that covers the roles of clients, servers, and peers, defines the trust boundaries, and outlines deployment assumptions.
- Formal API or protocol specifications, along with a suite of compatibility tests.
- Runbooks detailing the coordination required for rollouts, such as client release waves, backward-compatibility support, or operational procedures for a peer-to-peer network.

## Risks & Mitigations
- **"Chatty" Clients**:
  - **Mitigation**: A client making too many small requests can lead to poor performance. Consolidate API calls using patterns like the Façade or Gateway, and implement caching strategies on the client or at the network edge.
- **"Thick" Clients with Duplicated Logic**:
  - **Mitigation**: When clients contain too much business logic, it often becomes duplicated and out-of-sync with the server. Share validation logic by packaging it in a common library or move the rules definitively to the server.
- **Peer-to-Peer Data Conflicts**:
  - **Mitigation**: In a peer-to-peer model, data conflicts are inevitable. Design formal conflict resolution strategies (e.g., CRDTs, last-write-wins) and consensus mechanisms from the beginning.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
