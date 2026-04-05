# Classification System

Features are classified along two orthogonal axes that determine architectural and UX implications.

## Axis 1: Proactive vs Reactive

This axis describes **when** the feature acts relative to user intent.

### Proactive Features

**Definition:** Anticipates user needs and acts before explicit request.

**Characteristics:**
- Runs in background or ahead of user action
- Requires prediction/inference of user intent
- May consume resources speculatively
- Higher latency tolerance (users don't wait)

**Latency Tolerance:**
- Background processing acceptable (seconds to minutes)
- User doesn't perceive delay directly
- Can be batched or deferred

**Examples:**
| Feature | How It's Proactive |
|---------|-------------------|
| Auto-save | Saves before user requests |
| Prefetching | Loads data before navigation |
| Suggestions | Offers options before user types |
| Health checks | Monitors before problems occur |
| Cache warming | Prepares data before access |

**Tradeoffs:**
| Pro | Con |
|-----|-----|
| Reduces user effort | May waste resources |
| Feels "smart" | Can be wrong/intrusive |
| Prevents problems | Requires more data |
| Smoother UX | Higher complexity |

**Architecture Patterns:**
- Event-driven / pub-sub
- Background workers
- Predictive models
- Eventual consistency acceptable

### Reactive Features

**Definition:** Responds to explicit user input or system events.

**Characteristics:**
- Triggered by user action
- Must feel immediate
- Resources used on-demand
- Correctness over speculation

**Latency Tolerance:**
- Sub-100ms for UI feedback
- Sub-1s for completion
- User actively waiting

**Examples:**
| Feature | How It's Reactive |
|---------|------------------|
| Form submission | User clicks submit |
| Search | User types query |
| Navigation | User clicks link |
| Validation | User enters input |
| Commands | User invokes action |

**Tradeoffs:**
| Pro | Con |
|-----|-----|
| User in control | User must initiate |
| Predictable behavior | No anticipation |
| Lower resource waste | Perceived latency |
| Simpler to implement | Less "magical" UX |

**Architecture Patterns:**
- Request/response
- Synchronous processing
- Strong consistency
- Direct invocation

### Classification Decision Tree

```
Is the feature triggered by explicit user action?
├── Yes → Is immediate response critical?
│   ├── Yes → REACTIVE
│   └── No → Could be either (consider UX goals)
└── No → Does it require user data/context?
    ├── Yes → PROACTIVE (with data)
    └── No → PROACTIVE (autonomous)
```

## Axis 2: Static vs Dynamic

This axis describes **how** feature data changes over time.

### Static Features

**Definition:** Data changes incrementally through explicit updates.

**Characteristics:**
- Version-controlled or release-based updates
- Can be cached aggressively
- Deterministic lookups
- Stale data possible but predictable

**Update Pattern:**
- Deploy-time updates
- Batch processing
- Periodic refresh
- Manual triggers

**Storage Models:**
| Model | Use Case |
|-------|----------|
| Files | Configuration, templates |
| Embedded | Constants, schemas |
| CDN | Assets, documentation |
| Read replicas | Reference data |

**Lookup Cost:** O(1) or O(log n), highly cacheable

**Examples:**
| Feature | Why It's Static |
|---------|----------------|
| Skill definitions | Updated via deploy |
| Documentation | Published versions |
| Configuration | Changed by admin |
| Templates | Version-controlled |
| Schema definitions | Release-based |

**Tradeoffs:**
| Pro | Con |
|-----|-----|
| Fast lookups | Can be stale |
| Simple architecture | Update lag |
| Highly cacheable | Deployment required |
| Predictable performance | Less responsive |

### Dynamic Features

**Definition:** Data changes continuously through ongoing operations.

**Characteristics:**
- Real-time or near-real-time updates
- Limited caching opportunity
- Query-based lookups
- Consistency challenges

**Update Pattern:**
- Event-driven updates
- Streaming ingestion
- Live queries
- Continuous sync

**Storage Models:**
| Model | Use Case |
|-------|----------|
| Database | Transactional data |
| Cache layer | Hot data |
| Stream | Events, logs |
| Search index | Queryable content |

**Lookup Cost:** O(log n) to O(n), cache hit-rate varies

**Examples:**
| Feature | Why It's Dynamic |
|---------|-----------------|
| User sessions | Real-time state |
| Search results | Live queries |
| Notifications | Streaming events |
| Analytics | Continuous ingestion |
| Collaboration | Multi-user sync |

**Tradeoffs:**
| Pro | Con |
|-----|-----|
| Always fresh | Higher latency |
| Responsive to change | Complex architecture |
| Real-time capable | Consistency challenges |
| User-specific | Harder to cache |

### Classification Decision Tree

```
Does the data change based on user actions in real-time?
├── Yes → DYNAMIC
└── No → Is freshness critical (< 1 hour)?
    ├── Yes → DYNAMIC
    └── No → Could the data be served from cache/CDN?
        ├── Yes → STATIC
        └── No → Consider hybrid (static + refresh)
```

## The 2x2 Matrix

Combining both axes creates four feature archetypes:

```
                    STATIC                 DYNAMIC
              ┌─────────────────────┬─────────────────────┐
              │                     │                     │
   PROACTIVE  │   Predictive Cache  │   Smart Assistant   │
              │   (prefetch static) │   (live suggestions)│
              │                     │                     │
              │   Latency: Low      │   Latency: Medium   │
              │   Complexity: Low   │   Complexity: High  │
              │                     │                     │
              ├─────────────────────┼─────────────────────┤
              │                     │                     │
   REACTIVE   │   Reference Lookup  │   Interactive Query │
              │   (docs, configs)   │   (search, forms)   │
              │                     │                     │
              │   Latency: Very Low │   Latency: Low      │
              │   Complexity: Low   │   Complexity: Medium│
              │                     │                     │
              └─────────────────────┴─────────────────────┘
```

### Archetype Details

#### Predictive Cache (Proactive + Static)

- **Example:** Prefetching documentation pages
- **Pattern:** Background worker loads static assets
- **Complexity:** Low - just scheduling and caching
- **Risk:** Wasted bandwidth if prediction wrong

#### Smart Assistant (Proactive + Dynamic)

- **Example:** AI-powered suggestions based on context
- **Pattern:** Real-time inference on streaming data
- **Complexity:** High - ML models, data pipelines
- **Risk:** Expensive, can be wrong, privacy concerns

#### Reference Lookup (Reactive + Static)

- **Example:** Loading skill definitions
- **Pattern:** Cache-first, fallback to file
- **Complexity:** Low - simple read operations
- **Risk:** Stale data if cache not invalidated

#### Interactive Query (Reactive + Dynamic)

- **Example:** Search across current repository
- **Pattern:** Query on demand, may use indexes
- **Complexity:** Medium - query optimization, indexing
- **Risk:** Variable latency, consistency windows

## Classification for Common Features

| Feature Type | Typical Classification | Notes |
|--------------|----------------------|-------|
| CLI Commands | Reactive + Static | User-invoked, defined behavior |
| Auto-complete | Proactive + Dynamic | Predicts input from context |
| Configuration | Reactive + Static | Loaded on demand, versioned |
| Session state | Reactive + Dynamic | User-driven, real-time |
| Caching layer | Proactive + Static | Anticipates access patterns |
| Notifications | Proactive + Dynamic | Pushed based on events |
| Validation | Reactive + Static | Rules are static, input is dynamic |
| Analytics | Proactive + Dynamic | Background collection |

## Using Classification in Review

When reviewing features:

1. **Identify current classification** - What is it today?
2. **Evaluate fit** - Does classification match use case?
3. **Consider migration** - Would different classification improve UX?
4. **Note tradeoffs** - What would change with different classification?

**Red Flags:**
- Reactive feature with high latency → Consider proactive alternative
- Dynamic feature rarely changing → Could be static for performance
- Proactive feature often wrong → Consider reactive fallback
- Static feature causing staleness issues → Consider dynamic refresh
