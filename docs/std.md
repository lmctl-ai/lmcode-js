# Built-in lmcode std v3

Canonical signatures: 206.

**Bytes:** All strings are raw bytes; lengths and offsets are byte-based, NUL and invalid UTF-8 are preserved.

**Encoding:** Hex is lowercase on encode and accepts ASCII mixed-case digits on decode. Base64 is canonical padded RFC 4648 section 4, rejecting whitespace, URL-safe alphabet, invalid padding and nonzero pad bits. Strings are raw bytes.

**Errors:** Catalog failures use RUN_HOST; file failures use FUNCTION: PATH: OS reason.

**Json:** Json is immutable strict UTF-8 JSON: scalar Unicode, signed int64 or finite binary64, depth 256, duplicate decoded keys/BOM rejected. Compact output preserves number/string token spellings; navigation borrows nodes until run end.

**Lifetime:** Default registries own standard collection lifetimes; handles are valid only for the active run. Collections and Json roots have no implicit object-count budget; platform representability and allocation errors remain.

**Paths:** Relative file paths use the process cwd without sandbox or root checks. Unix preserves native path bytes; Windows requires strict UTF-8 and supports long drive/UNC paths. Every platform rejects embedded NUL. Symlinks are followed; missing/broken paths and nonregular objects return false from file_exists, while other metadata errors trap.

**Priority:** PQ is min-first with insertion-order ties; signed zero priorities tie. Nonfinite priorities and next sequence 2^63-1 fail without mutation; clear resets sequence to zero.

**Registration:** Default registries install 206 built-ins; testing print/assertions remain explicit host registrations. Return-sink imports are host-bound and write only to an invocation-owned sink.

**Results:** The invocation-owned ResultSink is external to arenas and retains owned writes across body/entry calls. JSON values use strict UTF-8, safe mathematical integers (±9007199254740991), finite binary64 and shortest-round-trip formatting; explicit successful host framing follows dispatch and application validation.

**Snapshots:** Map keys()/values() each allocate one independent list snapshot in insertion order; mutation never aliases map storage. Float payload bits are preserved.

**Templates:** One-pass text rendering with nested JSON context, zero-based indexed lists, list loops and strict boolean conditions. Strings insert verbatim; other values use compact JSON. No recursive interpolation or format-specific escaping.

| Signature | Area | Semantics | Errors |
| --- | --- | --- | --- |
| `fn file_append(string, string) -> void` | file | Create or append all raw bytes to a regular file. | FUNCTION: PATH: OS reason |
| `fn file_exists(string) -> bool` | file | Return true only when metadata identifies a regular file; missing and nonregular paths return false. | FUNCTION: PATH: OS reason |
| `fn file_lines(string) -> StrList` | file | Read raw bytes and split on every LF, preserving CR and empty fields: empty file gives [""], and "a\n" gives ["a", ""]. Return an arena-owned StrList. | FUNCTION: PATH: OS reason |
| `fn file_read(string) -> string` | file | Read a complete regular file as raw bytes. | FUNCTION: PATH: OS reason |
| `fn file_write(string, string) -> void` | file | Create or truncate a regular file and write all raw bytes. | FUNCTION: PATH: OS reason |
| `fn float_list() -> FloatList` | collections | Construct an empty FloatList in the active collection arena. | — |
| `fn float_map() -> FloatMap` | collections | Create an insertion-ordered byte-key map. | — |
| `fn float_pq() -> FloatPQ` | collections | Create an empty FloatPQ in the run arena. | — |
| `fn float_queue() -> FloatQueue` | collections | Create an empty FloatQueue in the run arena. | — |
| `fn float_stack() -> FloatStack` | collections | Create an empty FloatStack in the run arena. | — |
| `fn int_list() -> IntList` | collections | Construct an empty IntList in the active collection arena. | — |
| `fn int_map() -> IntMap` | collections | Create an insertion-ordered byte-key map. | — |
| `fn int_pq() -> IntPQ` | collections | Create an empty IntPQ in the run arena. | — |
| `fn int_queue() -> IntQueue` | collections | Create an empty IntQueue in the run arena. | — |
| `fn int_stack() -> IntStack` | collections | Create an empty IntStack in the run arena. | — |
| `fn json_parse(string) -> Json` | json | Parse strict UTF-8 JSON eagerly; int64 integers, finite binary64 decimals, depth <=256, duplicate decoded keys rejected. | json_parse: REASON at byte N |
| `fn lmcode_return_null() -> void` | return | Replace the selected program result with null. | lmcode return: no result sink; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_put(string, FloatList) -> void` | return | Store an owned float list at a top-level JSON object key in the selected program result. | lmcode return: no result sink; lmcode return: field assignment requires object or null; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_put(string, FloatMap) -> void` | return | Store an owned float map at a top-level JSON object key in the selected program result. | lmcode return: no result sink; lmcode return: field assignment requires object or null; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_put(string, IntList) -> void` | return | Store an owned int list at a top-level JSON object key in the selected program result. | lmcode return: no result sink; lmcode return: field assignment requires object or null; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_put(string, IntMap) -> void` | return | Store an owned int map at a top-level JSON object key in the selected program result. | lmcode return: no result sink; lmcode return: field assignment requires object or null; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_put(string, Json) -> void` | return | Store an owned JSON value at a top-level JSON object key in the selected program result. | lmcode return: no result sink; lmcode return: field assignment requires object or null; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_put(string, StrList) -> void` | return | Store an owned string list at a top-level JSON object key in the selected program result. | lmcode return: no result sink; lmcode return: field assignment requires object or null; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_put(string, StrMap) -> void` | return | Store an owned string map at a top-level JSON object key in the selected program result. | lmcode return: no result sink; lmcode return: field assignment requires object or null; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_put(string, bool) -> void` | return | Store a bool at a top-level JSON object key in the selected program result. | lmcode return: no result sink; lmcode return: field assignment requires object or null; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_put(string, float) -> void` | return | Store a float at a top-level JSON object key in the selected program result. | lmcode return: no result sink; lmcode return: field assignment requires object or null; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_put(string, int) -> void` | return | Store an int at a top-level JSON object key in the selected program result. | lmcode return: no result sink; lmcode return: field assignment requires object or null; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_put(string, string) -> void` | return | Store a string at a top-level JSON object key in the selected program result. | lmcode return: no result sink; lmcode return: field assignment requires object or null; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_put_null(string) -> void` | return | Store null at a JSON object path in the selected program result. | lmcode return: no result sink; lmcode return: field assignment requires object or null; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_set(FloatList) -> void` | return | Replace the selected program result with an owned float list. | lmcode return: no result sink; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_set(FloatMap) -> void` | return | Replace the selected program result with an owned float map. | lmcode return: no result sink; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_set(IntList) -> void` | return | Replace the selected program result with an owned int list. | lmcode return: no result sink; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_set(IntMap) -> void` | return | Replace the selected program result with an owned int map. | lmcode return: no result sink; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_set(Json) -> void` | return | Replace the selected program result with an owned JSON value. | lmcode return: no result sink; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_set(StrList) -> void` | return | Replace the selected program result with an owned string list. | lmcode return: no result sink; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_set(StrMap) -> void` | return | Replace the selected program result with an owned string map. | lmcode return: no result sink; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_set(bool) -> void` | return | Replace the selected program result with an owned bool. | lmcode return: no result sink; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_set(float) -> void` | return | Replace the selected program result with an owned float. | lmcode return: no result sink; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_set(int) -> void` | return | Replace the selected program result with an owned int. | lmcode return: no result sink; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn lmcode_return_set(string) -> void` | return | Replace the selected program result with an owned string. | lmcode return: no result sink; lmcode return: invalid JSON value at PATH: REASON; lmcode return: result sink is sealed; lmcode return: result type mismatch at PATH: expected T; got K |
| `fn math_abs(float) -> float` | math | Absolute value; integer arithmetic wraps, and float signed zero is cleared. | — |
| `fn math_abs(int) -> int` | math | Absolute value; integer arithmetic wraps, and float signed zero is cleared. | — |
| `fn math_ceil(float) -> float` | math | Identity for int; ceiling for binary64 while preserving signed zero. | — |
| `fn math_ceil(int) -> int` | math | Identity for int; ceiling for binary64 while preserving signed zero. | — |
| `fn math_floor(float) -> float` | math | Identity for int; floor for binary64 while preserving signed zero. | — |
| `fn math_floor(int) -> int` | math | Identity for int; floor for binary64 while preserving signed zero. | — |
| `fn math_max(float, float) -> float` | math | Maximum; integer comparison, or NaN propagation with first-operand ties for floats. | — |
| `fn math_max(int, int) -> int` | math | Maximum; integer comparison, or NaN propagation with first-operand ties for floats. | — |
| `fn math_min(float, float) -> float` | math | Minimum; integer comparison, or NaN propagation with first-operand ties for floats. | — |
| `fn math_min(int, int) -> int` | math | Minimum; integer comparison, or NaN propagation with first-operand ties for floats. | — |
| `fn math_pow(float, float) -> float` | math | Float power follows IEEE/libm special cases. | — |
| `fn math_pow(int, int) -> int` | math | Integer exponentiation wraps modulo 2^64; the exponent must be nonnegative. | math_pow: integer exponent must be nonnegative |
| `fn math_round(float) -> float` | math | Identity for int; binary64 nearest integer with halfway cases away from zero. | — |
| `fn math_round(int) -> int` | math | Identity for int; binary64 nearest integer with halfway cases away from zero. | — |
| `fn math_sqrt(float) -> float` | math | Binary64 square root for float. | — |
| `fn math_sqrt(int) -> int` | math | Exact floor integer square root; the argument must be nonnegative. | math_sqrt: integer argument must be nonnegative |
| `fn str_base64_decode(string) -> string` | encoding | Decode canonical padded RFC 4648 Base64; reject whitespace, URL-safe symbols, invalid padding and nonzero pad bits. Empty input is legal. | str_base64_decode: invalid encoding |
| `fn str_base64_encode(string) -> string` | encoding | Encode bytes as canonical padded RFC 4648 Base64 without line breaks. Empty input is legal. | str_base64_encode: size overflow |
| `fn str_contains(string, string) -> bool` | string | Byte substring search; an empty needle matches. | — |
| `fn str_ends_with(string, string) -> bool` | string | Byte suffix comparison; an empty suffix matches. | — |
| `fn str_find(string, string) -> int` | string | Return the first byte offset or -1; an empty needle returns 0. | — |
| `fn str_hex_decode(string) -> string` | encoding | Decode an even number of ASCII 0-9/a-f/A-F digits; reject separators, prefixes and whitespace. Empty input is legal. | str_hex_decode: invalid encoding |
| `fn str_hex_encode(string) -> string` | encoding | Encode bytes as lowercase ASCII hex. Empty input is legal. | str_hex_encode: size overflow |
| `fn str_is_float(string) -> bool` | string | Accept a complete signed decimal with optional decimal point and exponent, including representable subnormals. Reject whitespace, hex, NaN/infinity, overflow and underflow to zero. | — |
| `fn str_is_int(string) -> bool` | string | Report whether the complete signed decimal token fits int64. | — |
| `fn str_len(string) -> int` | string | Return the raw byte length, including NUL and invalid UTF-8 bytes. | — |
| `fn str_list() -> StrList` | collections | Construct an empty StrList in the active collection arena. | — |
| `fn str_lower(string) -> string` | string | Lowercase ASCII A-Z bytes; preserve every other byte. | — |
| `fn str_map() -> StrMap` | collections | Construct an empty insertion-ordered StrMap in the active collection arena. | — |
| `fn str_match(string, string) -> bool` | string | Match a whole byte string with *, ?, classes, ranges, negation, and backslash escapes. | — |
| `fn str_pq() -> StrPQ` | collections | Create an empty StrPQ in the run arena. | — |
| `fn str_queue() -> StrQueue` | collections | Create an empty StrQueue in the run arena. | — |
| `fn str_repeat(string, int) -> string` | string | Repeat raw bytes; reject negative counts and platform-unrepresentable result sizes. | str_repeat: count must be nonnegative; str_repeat: result size exceeds platform capacity |
| `fn str_replace(string, string, string) -> string` | string | Replace nonoverlapping byte matches left to right; an empty search leaves bytes unchanged. No implicit result-size budget. | str_replace: result size exceeds platform capacity |
| `fn str_split(string, string) -> StrList` | collections | Split raw bytes on every nonoverlapping nonempty separator into a StrList. | str_split: separator must not be empty |
| `fn str_stack() -> StrStack` | collections | Create an empty StrStack in the run arena. | — |
| `fn str_starts_with(string, string) -> bool` | string | Byte prefix comparison; an empty prefix matches. | — |
| `fn str_substr(string, int, int) -> string` | string | Return a byte slice; clamp negative starts and overlong counts, with nonpositive counts empty. | — |
| `fn str_to_float(string) -> float` | string | Parse the same complete decimal grammar as str_is_float; return 0.0 on invalid input, overflow or underflow to zero. Preserve valid signed zero. | — |
| `fn str_to_int(string) -> int` | string | Parse a complete signed decimal int64 token; return zero on failure. | — |
| `fn str_trim(string) -> string` | string | Remove ASCII space and bytes 0x09 through 0x0d from both ends. | — |
| `fn str_upper(string) -> string` | string | Uppercase ASCII a-z bytes; preserve every other byte. | — |
| `fn template_render(string, Json) -> string` | string | Render arbitrary text with <path>, <items[0]>, <items:{item\|body}; separator=", "> and <if(flag)>yes<else>no<endif>. Loop index is zero-based. << emits <. Inserted values remain literal. | template_render: context must be an object; template_render: missing variable PATH; template_render: loop requires a list: PATH; template_render: condition requires a bool: PATH; template_render: unterminated block; template_render: unexpected conditional delimiter; template_render: invalid loop separator; template_render: index is reserved; template_render: maximum nesting exceeded |
| `method FloatList.add(float) -> FloatList` | collections | Append a float and return the receiver. | — |
| `method FloatList.at(int) -> float` | collections | Return the element at a zero-based index. | FloatList.at: index out of range: i |
| `method FloatList.clear() -> FloatList` | collections | Remove elements and return the receiver. | — |
| `method FloatList.contains(float) -> bool` | collections | Test float == equality; NaN never matches. | — |
| `method FloatList.index_of(float) -> int` | collections | Return the first float == index or -1; NaN never matches. | — |
| `method FloatList.len() -> int` | collections | Return element count. | — |
| `method FloatList.set(int, float) -> FloatList` | collections | Replace an indexed float and return the receiver. | FloatList.set: index out of range: i |
| `method FloatMap.clear() -> FloatMap` | collections | Remove all keys; return self. | — |
| `method FloatMap.get(string) -> float` | collections | Read a value. | FloatMap.get: missing key |
| `method FloatMap.get_or(string, float) -> float` | collections | Read a value or the supplied fallback. | — |
| `method FloatMap.has(string) -> bool` | collections | Test a byte-exact key. | — |
| `method FloatMap.key_at(int) -> string` | collections | Read a live key in insertion order. | FloatMap.key_at: index out of range: N |
| `method FloatMap.keys() -> StrList` | containers | Allocate an independent StrList snapshot of keys in insertion order; later map/list mutations do not alias. Preserve raw bytes and float payload bits. | — |
| `method FloatMap.len() -> int` | collections | Count live keys. | — |
| `method FloatMap.remove(string) -> bool` | collections | Remove a key; reinsertion goes last. | — |
| `method FloatMap.set(string, float) -> FloatMap` | collections | Insert/update; overwrites retain original position; return self. | — |
| `method FloatMap.values() -> FloatList` | containers | Allocate an independent FloatList snapshot of values in insertion order; later map/list mutations do not alias. Preserve raw bytes and float payload bits. | — |
| `method FloatPQ.clear() -> FloatPQ` | collections | Remove all items; return self; reset PQ insertion sequence. | — |
| `method FloatPQ.empty() -> bool` | collections | Return whether there are no items. | — |
| `method FloatPQ.len() -> int` | collections | Return the number of items. | — |
| `method FloatPQ.peek() -> float` | collections | Read without removing the next item in pop order. | FloatPQ.peek: empty |
| `method FloatPQ.pop() -> float` | collections | Remove and return the next item in pop order. | FloatPQ.pop: empty |
| `method FloatPQ.push(float, float) -> FloatPQ` | collections | Push with finite min-first priority; stable insertion-order ties including signed zero. | FloatPQ.push: priority must be finite; FloatPQ.push: insertion sequence exhausted |
| `method FloatQueue.at(int) -> float` | collections | Read in pop order without consuming; index zero is next to pop. | FloatQueue.at: index out of range: N |
| `method FloatQueue.clear() -> FloatQueue` | collections | Remove all items; return self; reset PQ insertion sequence. | — |
| `method FloatQueue.empty() -> bool` | collections | Return whether there are no items. | — |
| `method FloatQueue.len() -> int` | collections | Return the number of items. | — |
| `method FloatQueue.peek() -> float` | collections | Read without removing the next item in pop order. | FloatQueue.peek: empty |
| `method FloatQueue.pop() -> float` | collections | Remove and return the next item in pop order. | FloatQueue.pop: empty |
| `method FloatQueue.push(float) -> FloatQueue` | collections | Append an item; return the same container. | — |
| `method FloatStack.at(int) -> float` | collections | Read in pop order without consuming; index zero is next to pop. | FloatStack.at: index out of range: N |
| `method FloatStack.clear() -> FloatStack` | collections | Remove all items; return self; reset PQ insertion sequence. | — |
| `method FloatStack.empty() -> bool` | collections | Return whether there are no items. | — |
| `method FloatStack.len() -> int` | collections | Return the number of items. | — |
| `method FloatStack.peek() -> float` | collections | Read without removing the next item in pop order. | FloatStack.peek: empty |
| `method FloatStack.pop() -> float` | collections | Remove and return the next item in pop order. | FloatStack.pop: empty |
| `method FloatStack.push(float) -> FloatStack` | collections | Append an item; return the same container. | — |
| `method IntList.add(int) -> IntList` | collections | Append an int and return the receiver. | — |
| `method IntList.at(int) -> int` | collections | Return the element at a zero-based index. | IntList.at: index out of range: i |
| `method IntList.clear() -> IntList` | collections | Remove elements and return the receiver. | — |
| `method IntList.contains(int) -> bool` | collections | Test integer equality of elements. | — |
| `method IntList.index_of(int) -> int` | collections | Return the first equal index or -1. | — |
| `method IntList.len() -> int` | collections | Return element count. | — |
| `method IntList.set(int, int) -> IntList` | collections | Replace an indexed int and return the receiver. | IntList.set: index out of range: i |
| `method IntMap.clear() -> IntMap` | collections | Remove all keys; return self. | — |
| `method IntMap.get(string) -> int` | collections | Read a value. | IntMap.get: missing key |
| `method IntMap.get_or(string, int) -> int` | collections | Read a value or the supplied fallback. | — |
| `method IntMap.has(string) -> bool` | collections | Test a byte-exact key. | — |
| `method IntMap.key_at(int) -> string` | collections | Read a live key in insertion order. | IntMap.key_at: index out of range: N |
| `method IntMap.keys() -> StrList` | containers | Allocate an independent StrList snapshot of keys in insertion order; later map/list mutations do not alias. Preserve raw bytes and float payload bits. | — |
| `method IntMap.len() -> int` | collections | Count live keys. | — |
| `method IntMap.remove(string) -> bool` | collections | Remove a key; reinsertion goes last. | — |
| `method IntMap.set(string, int) -> IntMap` | collections | Insert/update; overwrites retain original position; return self. | — |
| `method IntMap.values() -> IntList` | containers | Allocate an independent IntList snapshot of values in insertion order; later map/list mutations do not alias. Preserve raw bytes and float payload bits. | — |
| `method IntPQ.clear() -> IntPQ` | collections | Remove all items; return self; reset PQ insertion sequence. | — |
| `method IntPQ.empty() -> bool` | collections | Return whether there are no items. | — |
| `method IntPQ.len() -> int` | collections | Return the number of items. | — |
| `method IntPQ.peek() -> int` | collections | Read without removing the next item in pop order. | IntPQ.peek: empty |
| `method IntPQ.pop() -> int` | collections | Remove and return the next item in pop order. | IntPQ.pop: empty |
| `method IntPQ.push(int, float) -> IntPQ` | collections | Push with finite min-first priority; stable insertion-order ties including signed zero. | IntPQ.push: priority must be finite; IntPQ.push: insertion sequence exhausted |
| `method IntQueue.at(int) -> int` | collections | Read in pop order without consuming; index zero is next to pop. | IntQueue.at: index out of range: N |
| `method IntQueue.clear() -> IntQueue` | collections | Remove all items; return self; reset PQ insertion sequence. | — |
| `method IntQueue.empty() -> bool` | collections | Return whether there are no items. | — |
| `method IntQueue.len() -> int` | collections | Return the number of items. | — |
| `method IntQueue.peek() -> int` | collections | Read without removing the next item in pop order. | IntQueue.peek: empty |
| `method IntQueue.pop() -> int` | collections | Remove and return the next item in pop order. | IntQueue.pop: empty |
| `method IntQueue.push(int) -> IntQueue` | collections | Append an item; return the same container. | — |
| `method IntStack.at(int) -> int` | collections | Read in pop order without consuming; index zero is next to pop. | IntStack.at: index out of range: N |
| `method IntStack.clear() -> IntStack` | collections | Remove all items; return self; reset PQ insertion sequence. | — |
| `method IntStack.empty() -> bool` | collections | Return whether there are no items. | — |
| `method IntStack.len() -> int` | collections | Return the number of items. | — |
| `method IntStack.peek() -> int` | collections | Read without removing the next item in pop order. | IntStack.peek: empty |
| `method IntStack.pop() -> int` | collections | Remove and return the next item in pop order. | IntStack.pop: empty |
| `method IntStack.push(int) -> IntStack` | collections | Append an item; return the same container. | — |
| `method Json.as_bool() -> bool` | json | Read a boolean. | Json.as_bool: expected bool |
| `method Json.as_float() -> float` | json | Read binary64; integer conversion may round. | Json.as_float: expected number |
| `method Json.as_int() -> int` | json | Read a signed int64 integer. | Json.as_int: expected int |
| `method Json.as_string() -> string` | json | Read decoded UTF-8 bytes including escaped NUL. | Json.as_string: expected string |
| `method Json.at(int) -> Json` | json | Borrow an array child. | Json.at: expected array; Json.at: index out of range: N |
| `method Json.get(string) -> Json` | json | Borrow an object member. | Json.get: expected object; Json.get: missing key |
| `method Json.has(string) -> bool` | json | Test a decoded object key. | Json.has: expected object |
| `method Json.keys() -> StrList` | json | Snapshot keys in insertion order. | Json.keys: expected object |
| `method Json.kind() -> string` | json | Return null/bool/int/float/string/array/object. | — |
| `method Json.len() -> int` | json | Count array items or object keys. | Json.len: expected array or object |
| `method Json.to_json() -> string` | json | Emit compact tokens preserving number/string spellings and object order. | — |
| `method StrList.add(string) -> StrList` | collections | Append a byte string and return the receiver. | — |
| `method StrList.at(int) -> string` | collections | Return the element at a zero-based index. | StrList.at: index out of range: i |
| `method StrList.clear() -> StrList` | collections | Remove elements and return the receiver. | — |
| `method StrList.contains(string) -> bool` | collections | Test byte equality of elements. | — |
| `method StrList.index_of(string) -> int` | collections | Return the first byte-equal index or -1. | — |
| `method StrList.join(string) -> string` | collections | Join byte strings with a byte separator. | — |
| `method StrList.len() -> int` | collections | Return element count. | — |
| `method StrList.set(int, string) -> StrList` | collections | Replace an indexed byte string and return the receiver. | StrList.set: index out of range: i |
| `method StrMap.clear() -> StrMap` | collections | Remove entries and return the receiver. | — |
| `method StrMap.get(string) -> string` | collections | Return a byte-key value. | StrMap.get: missing key |
| `method StrMap.get_or(string, string) -> string` | collections | Return a byte-key value or the fallback. | — |
| `method StrMap.has(string) -> bool` | collections | Test byte-key presence. | — |
| `method StrMap.key_at(int) -> string` | collections | Return the insertion-order key at a zero-based index. | StrMap.key_at: index out of range: i |
| `method StrMap.keys() -> StrList` | collections | Allocate an independent StrList snapshot of keys in insertion order; later map/list mutations do not alias. Preserve raw bytes and float payload bits. | — |
| `method StrMap.len() -> int` | collections | Return insertion-order entry count. | — |
| `method StrMap.remove(string) -> bool` | collections | Remove a key and report whether it existed. | — |
| `method StrMap.set(string, string) -> StrMap` | collections | Insert or replace a value while preserving an existing key position; removal tombstones compact on key_at. | StrMap.set: index out of range: i |
| `method StrMap.values() -> StrList` | collections | Allocate an independent StrList snapshot of values in insertion order; later map/list mutations do not alias. Preserve raw bytes and float payload bits. | — |
| `method StrPQ.clear() -> StrPQ` | collections | Remove all items; return self; reset PQ insertion sequence. | — |
| `method StrPQ.empty() -> bool` | collections | Return whether there are no items. | — |
| `method StrPQ.len() -> int` | collections | Return the number of items. | — |
| `method StrPQ.peek() -> string` | collections | Read without removing the next item in pop order. | StrPQ.peek: empty |
| `method StrPQ.pop() -> string` | collections | Remove and return the next item in pop order. | StrPQ.pop: empty |
| `method StrPQ.push(string, float) -> StrPQ` | collections | Push with finite min-first priority; stable insertion-order ties including signed zero. | StrPQ.push: priority must be finite; StrPQ.push: insertion sequence exhausted |
| `method StrQueue.at(int) -> string` | collections | Read in pop order without consuming; index zero is next to pop. | StrQueue.at: index out of range: N |
| `method StrQueue.clear() -> StrQueue` | collections | Remove all items; return self; reset PQ insertion sequence. | — |
| `method StrQueue.empty() -> bool` | collections | Return whether there are no items. | — |
| `method StrQueue.len() -> int` | collections | Return the number of items. | — |
| `method StrQueue.peek() -> string` | collections | Read without removing the next item in pop order. | StrQueue.peek: empty |
| `method StrQueue.pop() -> string` | collections | Remove and return the next item in pop order. | StrQueue.pop: empty |
| `method StrQueue.push(string) -> StrQueue` | collections | Append an item; return the same container. | — |
| `method StrStack.at(int) -> string` | collections | Read in pop order without consuming; index zero is next to pop. | StrStack.at: index out of range: N |
| `method StrStack.clear() -> StrStack` | collections | Remove all items; return self; reset PQ insertion sequence. | — |
| `method StrStack.empty() -> bool` | collections | Return whether there are no items. | — |
| `method StrStack.len() -> int` | collections | Return the number of items. | — |
| `method StrStack.peek() -> string` | collections | Read without removing the next item in pop order. | StrStack.peek: empty |
| `method StrStack.pop() -> string` | collections | Remove and return the next item in pop order. | StrStack.pop: empty |
| `method StrStack.push(string) -> StrStack` | collections | Append an item; return the same container. | — |
