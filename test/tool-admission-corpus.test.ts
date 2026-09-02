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
 * THIS PORT FAILS THAT, ON ONE INPUT. `adm-0011` is pinned below in the
 * NEGATIVE and is a real security defect, not a stylistic drift. See G-33.
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
    expect(corpus.cases).toHaveLength(20);
  });

  it.each(corpus.cases)('$id decides the way the corpus recorded ($title)', (entry) => {
    expect(decide(entry)).toEqual(entry.admission.ts);
  });

  it('reserves confirmation for the human even under WILDCARD trust', () => {
    // The property the Lab probes live at /lab/team, and it holds here — for a
    // name with no trailing whitespace. See the next test for the one it
    // does not hold for, which is why a live probe on a clean name is not
    // enough on its own.
    const entry = caseOf('adm-0005');
    const decision = decide(entry);

    expect(entry.policy.mode).toBe('everyTool');
    expect(decision.allows).toBe(false);
    expect(decision.admitted).toBe(false);
  });

  it('ADMITS a confirm name with a trailing newline that the reference reserves', () => {
    // G-33, and a security defect in THIS port rather than a drift.
    //
    // `/(?:^|_)(?:confirm|…)$/i` — `$` without the `m` flag matches only at the
    // very end of the string in JavaScript, while PCRE and Python also match
    // before a final newline. So `terminal_confirm\n` is reserved for the human
    // in the reference and in the Python port, and handed to the agent here.
    //
    // A surface chooses its own tool names, so the newline is attacker-
    // controlled: one surface is safe against a PHP or Python agent and gives
    // this one the confirmation tool. Pinned in the NEGATIVE — closing G-33
    // turns this red, which is the point.
    const entry = caseOf('adm-0011');
    const decision = decide(entry);

    expect(entry.tool.name.endsWith('\n')).toBe(true);
    expect(decision.allows).toBe(true);
    expect(decision.admitted).toBe(true);
    expect(entry.admission.php.allows).toBe(false);
    expect(entry.admission.py.allows).toBe(false);
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

  it('ADMITS a confirm name with one trailing space, and so does every other language', () => {
    // G-36, and the worst finding in this suite precisely BECAUSE all three
    // agree. `$` tolerates at most one trailing newline in PCRE and Python and
    // none here, and nothing normalises the name before matching — so a surface
    // that calls its tool `terminal_confirm ` gets the confirmation tool handed
    // to the agent in every language.
    //
    // A cross-language corpus cannot find this by COMPARING languages; there is
    // nothing to compare. Asserted in the POSITIVE, describing the hole rather
    // than a guarantee, so the day someone closes it this row goes red.
    //
    // adm-0020 is the same hole reached by a second newline, which is why a fix
    // that only special-cases a single trailing newline — the shape of G-33 —
    // is visibly not enough.
    for (const id of ['adm-0019', 'adm-0020']) {
      const entry = caseOf(id);

      expect(entry.policy.mode).toBe('everyTool');
      expect(decide(entry).admitted, id).toBe(true);
      expect(entry.admission.php.admitted, id).toBe(true);
      expect(entry.admission.py.admitted, id).toBe(true);
    }
  });

  it('agrees with the reference on the pin, the allowlist and every clean name', () => {
    // Everything except the three registered rows. Asserted as a set so a NEW
    // divergence has somewhere to fail rather than disappearing into a row that
    // was already red.
    const known = new Set(['adm-0011', 'adm-0016', 'adm-0018']);
    const unexpected = corpus.cases
      .filter((entry) => !entry.agrees && !known.has(entry.id))
      .map((entry) => entry.id);

    expect(unexpected).toEqual([]);
  });
});
