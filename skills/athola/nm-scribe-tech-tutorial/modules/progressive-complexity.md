---
module: progressive-complexity
category: artifact-generation
dependencies: []
estimated_tokens: 480
---

# Building Complexity Gradually

The most common tutorial failure is starting too hard.
The reader gets lost before the baseline works, gives up, and
blames the tool.
Start with the minimum that produces a visible result.
Add variation only after that baseline is solid.

## The Minimal Example First

The first working example should be the shortest possible program
that demonstrates the core concept.
It need not be production-quality; it must be correct and runnable.

```markdown
BAD: Start with a full web server including auth, logging,
and database connections.

GOOD: Start with a server that returns "Hello, World!" on port 3000.
```

The minimal example answers one question: does this thing work?
Once the reader sees it working, they are ready to learn more.

## The Layering Model

Introduce complexity in layers.
Each layer adds one new concept or one new component.
A reader should be able to stop at any layer and have
a working system.

Layer pattern:

1. **Baseline** - The minimal working example
2. **First extension** - Add one realistic feature
3. **Second extension** - Add error handling or configuration
4. **Production pattern** - Show what the real thing looks like

Not every tutorial needs all four layers.
A focused tutorial may only need baseline plus one extension.

## Pacing Rules

- Complete one layer before describing the next
- State what you are about to add before adding it
- Do not introduce two new concepts in a single step
- Run the code after each layer to show it still works

```markdown
BAD:
"Now we will add authentication, a database connection,
and rate limiting..."

GOOD:
"The server works. Now add a database connection.
Authentication comes in the next section."
```

## When to Introduce Alternatives

Introduce alternative approaches only after the primary path works.
The reader needs one good path before they can evaluate tradeoffs.

```markdown
BAD: "You could use Redis or Memcached or an in-memory store here."

GOOD: "We use Redis here. Once this works, see [link] for
the Memcached variant."
```

## Complexity Signals to Watch For

Signs that a section has become too complex:

- A step has more than one code block with no "run this" between them
- You are explaining a concept that requires another concept first
- The expected output section requires more prose than the step itself
- You find yourself writing "before we continue, you should know..."

When you see these signals, split the section or move the prerequisite
knowledge into the Prerequisites section.

## End-State Clarity

The reader must know what they are building toward before they start.
State the end state in the "What You Will Build" section as a concrete
description, not a list of features:

```markdown
BAD:
"You will learn authentication, sessions, and middleware."

GOOD:
"By the end of this tutorial, you will have a Node.js server
that accepts a username and password, issues a signed JWT,
and rejects requests without a valid token."
```

The end state should be verifiable: the reader can check that they
achieved it by running one command or visiting one URL.
