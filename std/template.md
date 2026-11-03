# Text templates

The default standard registry provides:

~~~text
template_render(template: string, context: Json) -> string
~~~

The template is arbitrary text. JSON is the context container, not the output
format. No change to lmcode syntax or bytecode is required.

Given context:

~~~json
{
  "user": {"name": "Sam", "active": true},
  "items": [{"name": "apple"}, {"name": "pear"}]
}
~~~

| Template | Result |
| --- | --- |
| Hello, `<user.name>`! | Hello, Sam! |
| `<items[1].name>` | pear |
| `<items:{item\|<index>:<item.name>}; separator=", ">` | 0:apple, 1:pear |
| `<if(user.active)>enabled<else>disabled<endif>` | enabled |
| `<<user.name>` | `<user.name>` |

Rules shared by C++, Go, Java (also Kotlin/Scala), Rust and C#:

- Context must be a JSON object. Nested maps and lists are supported. Paths use
  ASCII identifiers, dots for map fields, and zero-based brackets for list
  items: `<matrix[1][2]>`. Indexes must be canonical nonnegative integers;
  `[00]` is rejected when resolved. Keys with punctuation cannot be addressed
  directly; their containing map can still be inserted.
- Strings insert verbatim. Other values use compact JSON, preserving numeric
  spellings and map order. Null becomes `null`. A whole map/list can be inserted.
- Rendering is one pass. Inserted text is never evaluated again, even if it
  contains placeholders, loops, conditions, or lmscript interpolation markers.
- List loops use `<items:{item|body}>`, optionally followed by a separator
  inside the expression: `<items:{item|body}; separator=", ">`. Separators are
  JSON string literals. No separator is emitted for an empty or single-item
  list. Loop-local `index` is zero-based and reserved as an item variable name.
- A loop can access the outer context and enclosing loop variables. Locals
  shadow outer names only inside that loop. Nested loops restore the outer
  item and index afterward. Empty lists emit nothing.
- Conditions use `<if(path)>body<else>other<endif>`. Else is optional. Conditions
  must be booleans; there is no implicit truthiness or expression evaluator.
  The entire template is parsed, but only the selected branch resolves values.
- Nesting of loops and conditions is limited to 256 levels. Missing paths,
  wrong context/condition/loop types and malformed block endings fail with
  `RUN_HOST`. Unknown text is literal; recognized conditional delimiters outside
  a condition are errors. Inside a loop, `}>` closes its body; insert such
  literal text through context when needed.
- `<<` emits a literal `<`. There is no automatic HTML/XML/JSON escaping.
  Prepare escaped fields in the caller when the output format requires it.
  Standard strings preserve raw bytes, including NUL and invalid UTF-8;
  context remains strict JSON.
- No includes, macros, function calls, expression language, or recursive
  interpolation. Compute decisions and derived values in lmcode or the host.

The portable vectors in [template-cases.json](template-cases.json) run against
each SDK's standard registration. The shared sample corpus also executes
successful and failing template programs through real host executables.

The compiler's standard schema must declare this signature. Before an npm
compiler release includes it by default, an explicit host schema declaration
with the identical signature works with the existing compiler.
