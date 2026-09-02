import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ToolDefinition, ToolRefused, TrustPolicy } from '../src/index.js';

/**
 * The cross-language tool-admission corpus from `prism-parity`.
 *
 * A Human+ surface is SHARED. The same surface is driven by a PHP application
 * and by this agent, so a tool the reference reserves for the human has to be
 * reserved here too — a name refused there and callable here is an agent
 * approving its own proposals, and nothing errors to say so.
 *
 * This port USED to fail that on one input — `terminal_confirm` with a trailing
 * newline was reserved in the reference and in Python and callable here, because
 * `$` matches before a final newline in PCRE and Python and not in JavaScript
 * (G-33). Closed by normalising the name; the tests below keep it closed.
 */
interface Decision {
  digest: string;
  declared: boolean;
  allows: boolean;
  admitted: boolean;
  message: string | null;
}

interface CorpusCase {
  id: string;
  title: string;
  tool: { name: string; description: string; input_schema_json: string };
  policy: { mode: string; tools: string[]; pins?: Record<string, string> };
  admission: { php: Decision; ts: Decision; py: Decision };
  agrees: boolean;
  disagrees_on: string[];
  notes: string;
}

const corpus = JSON.parse(
  readFileSync(new URL('./fixtures/human-plus-tool-admission.json', import.meta.url), 'utf8'),
) as { cases: CorpusCase[] };

function decide(entry: CorpusCase): Decision {
  // Parsed HERE, from the corpus's raw JSON text — the corpus explains why it
  // cannot be carried decoded.
  const schema = JSON.parse(entry.tool.input_schema_json);
  const tool = new ToolDefinition(entry.tool.name, entry.tool.description, schema);
  const digest = tool.digest();

  const pins: Record<string, string> = {};
  for (const [name, pin] of Object.entries(entry.policy.pins ?? {})) {
    pins[name] = pin === '@digest' ? digest : pin;
  }

  const policy =
    entry.policy.mode === 'undeclared'
      ? TrustPolicy.undeclared()
      : entry.policy.mode === 'everyTool'
        ? TrustPolicy.everyTool(pins)
        : TrustPolicy.allowing(entry.policy.tools, pins);

  let declared = true;
  let message: string | null = null;

  try {
    policy.assertDeclared();
  } catch (thrown) {
    declared = false;
    message = (thrown as ToolRefused).message;
  }

  let admitted = true;

  try {
    policy.assertAllows(tool);
  } catch (thrown) {
    admitted = false;
    if (message === null) message = (thrown as ToolRefused).message;
  }

  return { digest, declared, allows: policy.allows(tool.name), admitted, message };
}

const caseOf = (id: string): CorpusCase => corpus.cases.find((entry) => entry.id === id)!;

describe('the cross-language tool-admission corpus', () => {
  it('is the whole suite, not a subset someone trimmed to green', () => {
    expect(corpus.cases).toHaveLength(32);
  });

  it.each(corpus.cases)('$id decides the way the corpus recorded ($title)', (entry) => {
    expect(decide(entry)).toEqual(entry.admission.ts);
  });

  it('reserves confirmation for the human even under WILDCARD trust', () => {
    // The property the Lab probes live at /lab/team, on a clean tool name.
    // That probe was green while G-33 and G-36 were both open, which is why the
    // next test exists: the interesting question is not whether a clean name is
    // reserved but whether a name the SURFACE chose adversarially still is.
    const entry = caseOf('adm-0005');
    const decision = decide(entry);

    expect(entry.policy.mode).toBe('everyTool');
    expect(decision.allows).toBe(false);
    expect(decision.admitted).toBe(false);
  });

  it('reserves a confirm name whatever INVISIBLE character trails it', () => {
    // G-33 and G-36, both CLOSED — and this is the test that keeps them closed.
    //
    // A tool name is chosen by the SURFACE, and `$` anchors at the end. This
    // port matched only at the very end, so a trailing newline slipped past
    // here while the reference and Python reserved it (G-33); and a trailing
    // SPACE slipped past in all three (G-36), handing the confirmation tool to
    // the agent under every trust level including the wildcard.
    //
    // The normalisation strips an EXPLICIT codepoint set, spelled identically
    // in all three languages. That detail IS the fix: the built-ins disagree
    // three ways — this language's `.trim()` strips every one of these
    // including U+FEFF, PHP's strips none of the Unicode ones, and Python's
    // strips them except U+FEFF — so reaching for `.trim()` would have closed
    // one hole and opened three new divergences.
    const reserved = ['adm-0005', 'adm-0011', 'adm-0019', 'adm-0020', 'adm-0021', 'adm-0022', 'adm-0023', 'adm-0024', 'adm-0025'];

    for (const id of reserved) {
      const entry = caseOf(id);

      expect(decide(entry).allows, id).toBe(false);
      expect(decide(entry).admitted, id).toBe(false);
      // And the other two agree, which is the half a single-language suite
      // cannot check and the half that was actually broken.
      expect(entry.admission.php.allows, id).toBe(false);
      expect(entry.admission.py.allows, id).toBe(false);
    }
  });

  it('still admits the names that merely LOOK like a reserved verb', () => {
    // The other half of a reservation, and the half a fix like this can break.
    // Normalising only ever reserves MORE names, so these prove it did not
    // over-reach: `confirmation_status` and `preconfirm` stay callable.
    for (const id of ['adm-0009', 'adm-0010']) {
      const entry = caseOf(id);

      expect(decide(entry).admitted, id).toBe(true);
      expect(entry.admission.php.admitted, id).toBe(true);
      expect(entry.admission.py.admitted, id).toBe(true);
    }
  });

  it('REFUSES a name that is not well formed, in all three languages', () => {
    // The name rule, and the reason it exists beyond tidiness.
    //
    // adm-0026 is the one worth reading. A Cyrillic `с` in `сonfirm` does NOT
    // bypass the reservation — it genuinely is not `confirm`, so not reserving
    // it is correct — but a human reading an allowlist cannot tell it from the
    // real one. The hole is in the HUMAN's ability to audit the trust config,
    // which is the other half of the same trust model. An ASCII-only name rule
    // closes it; a cleverer regex over the reserved word never could.
    for (const id of ['adm-0026', 'adm-0027', 'adm-0028', 'adm-0029', 'adm-0030']) {
      const entry = caseOf(id);

      expect(decide(entry).allows, id).toBe(false);
      expect(decide(entry).admitted, id).toBe(false);
      expect(entry.admission.php.allows, id).toBe(false);
      expect(entry.admission.py.allows, id).toBe(false);
    }
  });

  it('still ADMITS the namespaced and hyphenated names real surfaces use', () => {
    // The direction a name rule breaks things, and the reason this one is not
    // stricter. Dots, colons and hyphens are how surfaces namespace tools; a
    // rule that refused `vendor.tool` or `web-search` would be unusable and
    // would get removed, taking the homoglyph guard with it.
    for (const id of ['adm-0031', 'adm-0032']) {
      const entry = caseOf(id);

      expect(decide(entry).admitted, id).toBe(true);
      expect(entry.admission.php.admitted, id).toBe(true);
      expect(entry.admission.py.admitted, id).toBe(true);
    }
  });

  it('digests a tool with NO schema differently from the reference', () => {
    // G-34, and here the reference is the one on the wrong side: an empty PHP
    // array encodes as `[]` and never `{}`. The consequence is a pin computed
    // against a PHP deployment failing in this port for the most ordinary tool
    // there is — one declared without a schema.
    //
    // Asserted in the POSITIVE for this port: `{}` is the right encoding, and
    // the Python port agrees with it.
    const entry = caseOf('adm-0016');

    expect(entry.tool.input_schema_json).toBe('{}');
    expect(decide(entry).digest).toBe(entry.admission.py.digest);
    expect(decide(entry).digest).not.toBe(entry.admission.php.digest);
  });

  it('agrees with the reference on the pin, the allowlist and every clean name', () => {
    // Everything except the two digest rows still registered (G-34, G-35).
    // Asserted as a set so a NEW divergence has somewhere to fail rather than
    // disappearing into a row that was already red — and so that closing either
    // one turns this red rather than leaving a stale exemption behind.
    const known = new Set(['adm-0016', 'adm-0018']);
    const unexpected = corpus.cases
      .filter((entry) => !entry.agrees && !known.has(entry.id))
      .map((entry) => entry.id);

    expect(unexpected).toEqual([]);
  });
});
