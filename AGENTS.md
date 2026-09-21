# AGENTS.md — prism-human-plus-ts

The TypeScript port of
[`particle-academy/prism-human-plus`](https://github.com/Particle-Academy/prism-human-plus).
Read the shared agent guide in `prism-parity/docs/AGENTS.md` first: the
boundary, the satellite map, the rules that bind, and the review skills.

## Gates — run them on EXIT CODES

```sh
npm run typecheck
npm run build
npx vitest run
```

Never pipe a gate into `head`/`tail`/`grep` and read `$?` — that is the
FILTER's exit code, not the gate's. Redirect to a file, echo `$?`, then look.

## What this package holds

The trust policy over agent-driveable surfaces, the result guard, attachment
authorization, and the surface/tool definitions a relay carries.

## The rule that binds every port here

**Faithful to the reference, or a DOCUMENTED divergence — never a quiet one.**
Where this port does something the reference does not, the reason is in the
code and in the envelope's port gaps register. A difference nobody wrote down
is drift, and drift is what this whole effort exists to prevent.

## Two writers, and the change feed

Ported from the reference in one pass, because they are one mechanism split in
two and porting only the second would have been a different feature wearing the
same name.

- **`SurfaceRevision`** is an opaque marker, pinned to EVERY call including
  reads. The package cannot tell a read from a write, and `readOnlyHint` is a
  hint the MCP spec says not to trust for security decisions — deciding from it
  would let a surface mark a mutating tool read-only and have its writes go out
  unpinned.
- **`conflictDetection()` and `changesSince()` report what was OBSERVED**, not
  what is configured. Both have a state that cannot be proven in advance
  (`minted`, `offered`) and one that is proven only by something happening
  (`enforced`, `attributed`). Neither proof is ever a precondition: a surface
  with one writer legitimately never rejects anything and never reports a human
  change.
- **An empty change list is not calm.** `answered()` before `changes`, always. A
  surface with no feed and a surface with nothing to report are the same empty
  array on the wire, and that ambiguity is the failure the feed exists to
  prevent.
- **`deferTo()` defers unless the surface positively said this agent did it.**
  On a surface that cannot attribute, that is every change.

`SurfaceRevision.observed()` measures its 512-byte ceiling with
`Buffer.byteLength`, not `.length`: a multi-byte marker would otherwise pass a
check the other two languages fail.
