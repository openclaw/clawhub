# Scalar environment declarations

A top-level SKILL.md `env` string containing one portable environment variable name is a required declaration, equivalent to a one-element string array. Trim surrounding whitespace and require `[A-Za-z_][A-Za-z0-9_]*`; do not interpret assignments, delimited lists, or shell syntax as variable names.

Keep the existing metadata namespace precedence. Structured metadata blocks own declarations when present; scalar shorthand does not merge into or replace them. Optional declarations remain optional. The parsed declaration feeds the existing installation guidance and scanner prompt, without granting a clean security verdict or changing historical versions.
