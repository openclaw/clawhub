---
module: code-examples
category: artifact-generation
dependencies: []
estimated_tokens: 550
---

# Writing Effective Code Examples

Code examples are the primary content of a technical tutorial.
Write and run each snippet before embedding it in the document.
A tutorial with untested code is broken.

## The Testing Rule

Every code block that the reader is expected to run must be tested
in a real environment before publication.
This means:

1. Run the command in a clean shell or container
2. Confirm the output matches what you claim
3. Record the exact output to quote in the tutorial
4. Note any version-specific behavior

If you cannot test a snippet, mark it clearly as untested:

```markdown
<!-- Note: untested on Windows; verified on macOS 14.3 -->
```

Never present guessed output as verified.

## Formatting Rules

Use fenced code blocks with a language identifier on every block:

```markdown
```bash
npm install express
```
```

Common language identifiers:

| Content Type | Identifier |
|--------------|------------|
| Shell commands | `bash` |
| Python | `python` |
| JavaScript/Node | `javascript` |
| YAML config | `yaml` |
| JSON output | `json` |
| Generic output | `text` |

Do not use `sh` as an identifier; use `bash` or `zsh` explicitly.

## Output Blocks

Show expected output after every command that produces visible output.
Use a `text` block with the label "Output:" on its own line:

```markdown
Run the server:

```bash
node server.js
```

Output:

```text
Server running on http://localhost:3000
```
```

If output is long, truncate with `...` and show the key lines:

```text
Downloading packages...
...
Successfully installed 14 packages in 2.3s
```

## Annotation Guidelines

Annotate only the non-obvious parts.
Over-annotation creates noise that pushes readers past the code.

Good annotation targets:

- A flag or option whose name does not explain itself
- A value the reader must substitute for their own
- A syntax form they may not have seen before

Mark substitution points with angle brackets:

```bash
git remote add origin git@github.com:<your-username>/<repo-name>.git
```

Do not annotate things that the code makes self-evident.

## Handling Errors in Examples

When showing an expected error (to teach debugging), be explicit:

```markdown
Running this command before installing dependencies will fail:

```bash
node server.js
```

Output:

```text
Error: Cannot find module 'express'
```

Install dependencies first, then retry.
```

Never silently show error output without explaining it.

## Long Code Example Handling

For files longer than 30 lines, show only the relevant portion:

```markdown
In `config/database.js`, update the connection string (line 12):

```javascript
// config/database.js (excerpt)
const connection = {
  host: process.env.DB_HOST,
  port: 5432,
  database: process.env.DB_NAME,
};
```
```

Provide a link to the full file in a repository if one exists.

## Verify Your Examples Work

Before including any example, run this checklist:

- [ ] Command produces the stated output
- [ ] Tested in the same environment as the reader will use
- [ ] Language identifier is present on the fenced block
- [ ] Output block follows every command with visible output
- [ ] Substitution points use angle bracket notation
- [ ] Untested blocks carry an explicit disclaimer
