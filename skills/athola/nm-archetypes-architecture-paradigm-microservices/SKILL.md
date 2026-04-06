---
name: architecture-paradigm-microservices
description: Apply microservices for independent deployment and per-service scaling
version: 1.8.1
triggers:
  - architecture
  - microservices
  - distributed-systems
  - team-autonomy
  - scalability
  - bounded contexts are clear
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/archetypes", "emoji": "\ud83c\udfd7\ufe0f"}}
source: claude-night-market
source_plugin: archetypes
---

> **Night Market Skill** — ported from [claude-night-market/archetypes](https://github.com/athola/claude-night-market/tree/master/plugins/archetypes). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [When to Employ This Paradigm](#when-to-employ-this-paradigm)
- [When NOT to Use This Paradigm](#when-not-to-use-this-paradigm)
- [Adoption Steps](#adoption-steps)
- [Key Deliverables](#key-deliverables)
- [Technology Guidance](#technology-guidance)
- [Risks & Mitigations](#risks-mitigations)
- [Troubleshooting](#troubleshooting)

# The Microservices Architecture Paradigm

## When to Employ This Paradigm
- When the organizational structure requires high levels of team autonomy and independent release cycles.
- When different business capabilities (bounded contexts) have distinct scaling requirements or would benefit from different technology stacks.
- When there is a significant organizational commitment to investing in DevOps and SRE maturity, including advanced observability, CI/CD, and incident response capabilities.

## When NOT To Use This Paradigm
- When team size is small and organizational complexity is low
- When lack of DevOps maturity or limited platform engineering resources
- When system requires strong transactional consistency across operations
- When early-stage startup with rapidly evolving requirements
- When regulatory constraints make distributed data management challenging

## Adoption Steps
1. **Define Bounded Contexts**: Map each microservice to a clear business capability and establish unambiguous data ownership.
2. **validate Service Data Autonomy**: Each service must own and control its own database or persistence mechanism. All data sharing between services must occur via APIs or events, not shared tables.
3. **Build a production-grade Platform**: Before deploying services, establish foundational infrastructure for service discovery, distributed tracing, centralized logging, CI/CD templates, and automated contract testing.
4. **Design for Resilience**: Implement resilience patterns such as timeouts, retries, circuit breakers, and bulkheads for all inter-service communication. Formally document Service Level Indicators (SLIs) and Objectives (SLOs).
5. **Automate Governance**: Implement automated processes to enforce security scanning, dependency management policies, and consistent versioning strategies across all services.

## Key Deliverables
- An Architecture Decision Record (ADR) cataloging all service boundaries, their corresponding data stores, and their communication patterns (e.g., synchronous API vs. asynchronous events).
- A set of "golden path" templates and runbooks for creating and operating new services on the platform.
- A detailed testing strategy that includes unit, contract, integration, and chaos/resilience tests.

## Technology Guidance

**API Communication**:
- **REST APIs**: Spring Boot (Java), Express.js (Node.js), FastAPI (Python)
- **GraphQL**: Apollo Server (Node.js), Hasura (PostgreSQL)
- **gRPC**: gRPC frameworks for high-performance internal communication

**Service Discovery & Configuration**:
- **Service Registry**: Consul, Eureka, etcd
- **Configuration**: Spring Cloud Config, HashiCorp Vault, AWS Parameter Store

**Message Broking & Events**:
- **Message Brokers**: Apache Kafka, RabbitMQ, AWS SQS/SNS
- **Event Streaming**: Apache Kafka, Apache Pulsar, AWS Kinesis

**Observability**:
- **Distributed Tracing**: Jaeger, Zipkin, AWS X-Ray
- **Metrics**: Prometheus, Datadog, CloudWatch
- **Logging**: ELK Stack, Fluentd, Splunk

## Real-World Examples

**Netflix**: Video streaming platform with hundreds of microservices handling different aspects like playback, recommendation, billing, and user authentication. Each team can deploy independently without affecting others.

**Amazon**: E-commerce platform with separate services for product catalog, order processing, payment, inventory, and shipping. Enables independent scaling during high-traffic events like Prime Day.

**Uber**: Ride-sharing platform with microservices for rider matching, driver dispatch, pricing, payment processing, and notifications, allowing rapid feature development and deployment.

## Risks & Mitigations
- **Distributed System Complexity**:
  - **Mitigation**: The operational overhead for a microservices architecture is substantial. Invest in dedicated platform teams and shared tooling to manage this complexity and provide support for service teams.
- **Data Consistency Challenges**:
  - **Mitigation**: Maintaining data consistency across services is a primary challenge. Employ patterns like Sagas for orchestrating transactions, validate message-based communication is idempotent, and use reconciliation jobs to handle eventual consistency.
- **Incorrect Service Granularity ("Over-splitting")**:
  - **Mitigation**: If services are too small, the communication overhead can outweigh the benefits of distribution. validate each service owns a meaningful and substantial piece of functionality. Monitor change coupling between services to identify candidates for merging.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
