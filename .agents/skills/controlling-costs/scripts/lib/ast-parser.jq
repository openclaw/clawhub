# AST Parser for Axiom APL queries
# Extracts column references, predicates, and query patterns from parse_apl() output

# Extract declared query parameter names and let statement variables from statements[]
def extract_declared_params:
  [
    # Query parameters: declare query_parameters (_param: string)
    (.statements[]? | select(.kind == "DeclareQueryParameters") | .parameters[]? | .name.name),
    # Let scalar variables: let x = 1
    (.statements[]? | select(.kind == "LetScalar") | .name.name),
    # Let tabular variables: let t = (table | query)
    (.statements[]? | select(.kind == "LetTabular") | .name.name),
    # Dataschema parameters: dataschema __orgID: string
    (.statements[]? | select(.kind == "Dataschema") | .schema.column.name)
  ] | unique;

# Flatten SelectorExpr to implicit column name: data.nested.field -> "data_nested_field"
def selector_to_implicit_name:
  if .kind == "SelectorExpr" then
    "\(.left | selector_to_implicit_name)_\(.selector.name)"
  elif .kind == "Entity" then .name
  else null
  end;

# Extract full field path from expression
# Handles: Entity, SelectorExpr (a.b.c), IndexExpr (a['b']), CallExpr wrappers (tolower(x))
def expr_to_field_path:
  if .kind == "Entity" then .name
  elif .kind == "SelectorExpr" then
    "\(.left | expr_to_field_path).\(.selector.name)"
  elif .kind == "IndexExpr" then
    # a['b'] -> a.b (index is typically a string literal for field access)
    (.left | expr_to_field_path) as $base |
    if .index.kind == "Literal" and (.index.value | type) == "string" then
      "\($base).\(.index.value)"
    else $base
    end
  elif .kind == "CallExpr" then
    # Unwrap function calls like tolower(field) -> field
    (.params[0]?.expr | expr_to_field_path) // null
  else null
  end;

# Extract aliases from a single operation
def extract_op_aliases:
  (
    # Project/Extend aliases: project foo = bar creates 'foo'
    (select(.kind == "Project" or .kind == "Extend") | .fields[]?.aliases[]?.name),
    # Summarize aggregation aliases: summarize foo = count() creates 'foo'
    (select(.kind == "Summarize") | .aggs[]?.aliases[]?.name),
    # Summarize implicit aliases: 
    # - count() -> count_
    # - sum(x) -> sum_x
    (select(.kind == "Summarize") | .aggs[]? | select(.aliases | length == 0) | .expr |
      if (.params | length) == 0 then "\(.func.name)_"
      elif .params[0].expr.kind == "Entity" then "\(.func.name)_\(.params[0].expr.name)"
      else "\(.func.name)_"
      end),
    # Summarize group aliases (less common but possible): summarize ... by foo = bar
    (select(.kind == "Summarize") | .groups[]?.aliases[]?.name),
    # Parse output columns: parse body with ... result:string creates 'result'
    (select(.kind == "Parse") | .parseWith[]? | select(.kind == "ParseWithTuple") | .column.name),
    # As tabular aliases: | as result (names the table, not a column, but appears in joins)
    (select(.kind == "As") | .alias),
    # Implicit aliases from SelectorExpr in project/extend: project data.field creates 'data_field'
    (select(.kind == "Project" or .kind == "Extend") | .fields[]? | 
      select(.aliases | length == 0) | .expr | select(.kind == "SelectorExpr") |
      selector_to_implicit_name)
  );

# Recursively extract aliases from all operations including nested joins/unions
def extract_all_op_aliases:
  if type == "array" then .[] | extract_all_op_aliases
  elif type == "object" then
    (if .kind then extract_op_aliases else empty end),
    (to_entries[] | .value | extract_all_op_aliases)
  else empty
  end;

# Extract all alias names defined by operations (project, extend, summarize output columns)
# These are derived columns, not original schema columns
def extract_defined_aliases:
  [.body | extract_all_op_aliases] | map(select(. != null)) | unique;

# Recursively extract column references, excluding dataset source names
# Takes a list of symbols to exclude (params + derived aliases)
def extract_columns_with_exclusions($exclude):
  if type == "array" then .[] | extract_columns_with_exclusions($exclude)
  elif type == "object" then
    # Skip Dataset nodes entirely (their nested Entity is the dataset name, not a column)
    if .kind == "Dataset" then empty
    # Skip query parameter declarations (not column references)
    elif .kind == "DeclareQueryParameters" then empty
    elif .kind == "QueryParameter" then empty
    # Skip Option nodes (join hints like kind=inner, hint.strategy=broadcast)
    elif .kind == "Option" then empty
    # Skip FieldPattern nodes (wildcard projections like project-keep ['prefix.']*) 
    elif .kind == "FieldPattern" then empty
    # Handle Parse: only extract from lhs (source column), skip parseWith (pattern/keywords)
    elif .kind == "Parse" then (.lhs | extract_columns_with_exclusions($exclude))
    # Skip CallExpr function names but recurse into params for column args
    elif .kind == "CallExpr" then (.params[]? | extract_columns_with_exclusions($exclude))
    # Handle IndexExpr: data['field'] -> extract full path
    elif .kind == "IndexExpr" then
      (. | expr_to_field_path) as $path |
      if $path and ($path | IN($exclude[]) | not) then $path else empty end
    # Handle SelectorExpr: data.field -> extract full path
    elif .kind == "SelectorExpr" then
      (. | expr_to_field_path) as $path |
      if $path and ($path | IN($exclude[]) | not) then $path else empty end
    # NamedExpression: only recurse into .expr, skip .aliases (output names, not input refs)
    elif .kind == "NamedExpression" then (.expr | extract_columns_with_exclusions($exclude))
    # Extract Entity names as column references, but filter out excluded symbols
    elif .kind == "Entity" and .name then
      if (.name | IN($exclude[])) then empty else .name end
    else (to_entries[] | .value | extract_columns_with_exclusions($exclude))
    end
  else empty
  end;

# Wrapper that extracts params and aliases first, then extracts columns filtering them out
def extract_columns:
  . as $root |
  (($root | extract_declared_params) + ($root | extract_defined_aliases) | unique) as $exclude |
  $root | extract_columns_with_exclusions($exclude);

# Extract filter predicates with field/op/value
def extract_predicates:
  if type != "object" then empty
  elif .kind == "BinaryExpr" and (.op | IN("==", "!=", "contains", "!contains", "startswith", "endswith", "!startswith", "contains_cs", ">", "<", ">=", "<=")) then
    # Use expr_to_field_path to get full dotted path
    (.left | expr_to_field_path) as $field |
    { field: ($field // null), op: .op, value: (.right.value // null) }
  elif .kind == "BinaryExpr" and (.op | IN("and", "or")) then
    (.left | extract_predicates), (.right | extract_predicates)
  elif .kind == "InExpr" then
    # Use expr_to_field_path for 'in' expressions too
    { field: (.left | expr_to_field_path), op: "in", values: [.right.list[]?.value] }
  elif .kind == "CallExpr" and .func.name == "not" then
    .params[]?.expr | extract_predicates
  else empty
  end;

# Main extraction - call this on a parsed APL AST
def extract_query_info:
  ((extract_declared_params) + (extract_defined_aliases) | unique) as $exclude |
  {
    all_columns: [.body | extract_columns_with_exclusions($exclude)] | unique,
    where_predicates: [.body.operations[]? | select(.kind == "Where") | .predicate | extract_predicates],
    summarize_groups: [.body.operations[]? | select(.kind == "Summarize") | .groups[]?.expr | 
      expr_to_field_path
    ] | map(select(. != null)),
    # Wildcard if: explicit "project *" OR no project operation at all (implicit all columns)
    has_wildcard: (
      ([.body.operations[]? | select(.kind == "Project") | .fields[]? | select(.kind == "Entity" and .name == "*")] | length > 0) or
      ([.body.operations[]? | select(.kind == "Project")] | length == 0)
    )
  };
