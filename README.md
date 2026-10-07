# Prism Human+ for TypeScript

Humans and agents sharing one surface, across a trust boundary. The TypeScript
port of
[`particle-academy/prism-human-plus`](https://github.com/Particle-Academy/prism-human-plus).

Zero runtime dependencies. Node 22+.

```
npm install @particle-academy/prism-human-plus
```

## Usage

```ts
import {
  HumanPlusManager,
  InMemoryAttachmentStore,
  TrustPolicy,
} from '@particle-academy/prism-human-plus';

const manager = new HumanPlusManager(
  myRelayTransport,
  new InMemoryAttachmentStore(),
  TrustPolicy.allowing(['sheet_write', 'web_search']),
);
```

A refusal throws a subclass of `HumanPlusError` — `ToolRefused`,
`AttachmentUnauthorized`, `SurfaceChangedUnderYou` and the rest — so the reason
is in the type, not only in the message.

## Confirmation belongs to the human

This is the property the package exists to hold. A surface offers tools; some of
those tools are how a person says **yes**. An agent that can call
`terminal_confirm` approves its own proposals, and the surface then has no way
to tell a human decision from a machine one.

So any tool name ending in `confirm`, `reject`, `accept`, `approve` or `deny` —
bare, or after an underscore — is **reserved for the human confirmation
surface** and refused to the agent under every trust level, the wildcard
included.

**The name is normalised against an explicit codepoint set before that check.**
That is not tidiness. A tool name is chosen by the *surface*, and before
normalisation a surface could name its tool `terminal_confirm ` — one trailing
space — and the reservation simply did not fire, handing the confirmation tool
to the agent with nothing raised anywhere. That was G-36, and it was broken in
**all three languages at once**, which is why no cross-language comparison could
see it.

The fix is a codepoint set spelled identically in PHP, Python and TypeScript —
deliberately **not** each language's own `trim()`, which would have closed the
ASCII hole and opened three new Unicode ones. This port also carried G-33: `$`
in a JavaScript regex matches only at the very end, while PCRE and Python also
match before a final trailing newline, so `terminal_confirm\n` was reserved in
the other two and callable here. Normalising closes both, which is why the
narrower fix was not taken.

Normalising can only ever make the check **more** inclusive — it can reserve a
name that was previously callable and can never un-reserve one. The allowlist is
matched against the raw name and is deliberately left untouched.

## Lost updates

A surface with two writers can lose one of them. `SurfaceRevision` carries what
the writer last saw, and a write against a stale revision raises
`SurfaceChangedUnderYou` rather than overwriting.

`ConflictDetection` is a four-state answer — `not_observed`, `unavailable`,
`minted`, `enforced` — because "we did not look" and "the surface cannot do it"
are different facts, and collapsing them to a boolean reports the first as
safety. `requireRevision` is off by default: a surface with one writer is not in
danger, and refusing it would be this package's opinion rather than a
protection.

## Attachments

An attachment belongs to an owner, and `AttachmentUnauthorized` is thrown when
anyone else reaches for it. The relay also refuses to resolve to a private or
reserved address — the same SSRF reasoning as `prism-browser`, applied to a
surface that fetches on an agent's behalf.

## Parity

Pinned against the PHP reference and the Python port by prism-parity's
human-plus corpora. Two gaps remain open on digests (G-34, G-35) and are tracked
in the envelope's port-gaps register. Worth reading before relying on
cross-language digest equality.
