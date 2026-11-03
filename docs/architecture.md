# Runtime representation and lifecycle

## Values

The bytecode tags distinguish integers from floats. `BigInt.asIntN(64, value)` implements wrapping after integer arithmetic, division truncates toward zero, and float operations remain `number`. VM strings store one byte per latin-1 code unit. The registry adapter converts to UTF-8 text at host boundaries, or accepts `{ rawStrings: true }` for Buffer-based host APIs.

## Loading and verification

The loader reads each wire count before appending data and reports truncation at the reader offset. It checks schema hashes before binding imports. Regions are decoded into instruction records with resolved targets, then verified for operands, loop pairs, jump boundaries, hidden locals, entry signatures, and reachable stack-depth joins. The `max_stack` field is an allocation hint only. Runtime dispatch uses the verified bytecode and has no instruction budget or wall-clock deadline.

## Standard objects

Collections and JSON nodes are tagged host handles tied to a registry run generation. The VM invalidates a generation when an execution ends; there is no object-count quota. Each dry dummy collection is newly allocated so separate dry calls cannot share mutable data.

## Results and invocation

A result sink belongs to one invocation slot. Values are copied at each write, checked against the optional schema result contract, and serialized with a terminal LF-preserving frame. Invocation manifests are validated before host setup. A collector records only the first failure and writes exactly one final envelope after the host drains work.
