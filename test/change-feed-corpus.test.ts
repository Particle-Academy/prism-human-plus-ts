import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SurfaceChanges, type ChangeFeed, type JsonObject } from '../src/index.js';

/*
 * The cross-language change-feed corpus from `prism-parity`.
 *
 * A Human+ surface is SHARED. A person edits the same canvas a PHP application
 * and a TypeScript or Python agent are editing, and each agent decides from
 * this answer whether to re-read before writing. If one language reports an
 * unanswerable feed as "nothing changed", the agent in that language re-reads,
 * sees current state, decides the surface has drifted from what it intended,
 * and puts it back OVER THE PERSON'S EDIT — with nothing stale anywhere, so no
 * pin fires, and no error at any layer.
 *
 * The fixture is a byte copy vendored into this repo. A runner that reached for
 * a sibling checkout would work in one directory layout and silently no-op in
 * CI, which checks out one repo.
 */

interface CorpusCase {
  id: string;
  title: string;
  input: { result: string; feed: ChangeFeed };
  rows: { php: string; ts: string; py: string };
  agrees: boolean;
}

const corpus: { cases: CorpusCase[] } = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'human-plus-change-feed.json'),
    'utf8',
  ),
);

/** The same conversion prism-parity's recorder makes. */
function answerFor(testCase: CorpusCase): JsonObject {
  // Parsed HERE, from the corpus's raw JSON text. Carrying the result decoded
  // in the case file would let a round trip through any language normalise the
  // values half these rows exist to test.
  return SurfaceChanges.readFrom(
    JSON.parse(testCase.input.result) as JsonObject,
    testCase.input.feed,
  ).toObject();
}

describe('human-plus-change-feed corpus', () => {
  it('is the whole suite, not a subset someone trimmed to green', () => {
    expect(corpus.cases).toHaveLength(23);
  });

  it.each(corpus.cases.map((testCase) => [`${testCase.id} — ${testCase.title}`, testCase] as const))(
    '%s',
    (_name, testCase) => {
      expect(JSON.stringify(answerFor(testCase))).toBe(testCase.rows.ts);
    },
  );

  it('agrees with the reference and the Python port on every case', () => {
    for (const testCase of corpus.cases) {
      expect([testCase.rows.ts, testCase.rows.py], testCase.id).toEqual([
        testCase.rows.php,
        testCase.rows.php,
      ]);
      expect(testCase.agrees, testCase.id).toBe(true);
    }
  });

  it('still cannot tell an unanswerable feed from a quiet one BY THE LIST ALONE', () => {
    // The property the suite exists for, asserted rather than inferred from
    // agreement: hpc-0009 and hpc-0010 differ only in the feed state, and both
    // carry an empty `changes`. A reader that looked at the list would call
    // them the same answer.
    const read = (id: string): JsonObject =>
      JSON.parse(corpus.cases.find((testCase) => testCase.id === id)?.rows.ts ?? '{}');

    expect(read('hpc-0009')['changes']).toEqual(read('hpc-0010')['changes']);
    expect(read('hpc-0009')['nothing_changed']).toBe(true);
    expect(read('hpc-0010')['nothing_changed']).toBe(false);
  });
});
