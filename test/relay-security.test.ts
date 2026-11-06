import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SsePostRelayTransport, SurfaceAttachment, SurfaceInvitation, AttachmentUnauthorized, type RelayHttp, type RelayTransportOptions } from '../src/index.js';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns', () => ({ promises: { lookup } }));
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/relay-security.json', import.meta.url), 'utf8'));
const frame = { jsonrpc: '2.0', id: 'probe', method: 'tools/call', params: {} };
const rpc = 'data: '+JSON.stringify({ jsonrpc: '2.0', id: 'probe', result: { fixture: true } })+'\n\n';

function attachment(url = 'https://relay.fixture.invalid', local = false) {
  return new SurfaceAttachment('surface_x', 'session:one', new SurfaceInvitation({
    relayBaseUrl: url, sessionId: 'b3session', token: 'T'.repeat(32), surfaceId: 'board:fixture',
    application: 'Fixture', allowInsecureLoopback: local,
  }), { id: 'agent:b3', name: 'Fixture', color: '#fff' }, 'b3_client');
}
function driver(options: Partial<RelayTransportOptions> = {}) {
  const counts = { posts: 0, streams: 0 };
  const http: RelayHttp = {
    post: async () => { counts.posts++; return { status: 200, body: '' }; },
    stream: async () => { counts.streams++; return { status: 200, chunks: (async function* () { yield rpc; })() }; },
  };
  return { counts, subject: new SsePostRelayTransport(http, {
    allowedRelayHosts: ['relay.fixture.invalid'], egressProxy: 'http://proxy.fixture:3128', ...options,
  }) };
}
beforeEach(() => { lookup.mockReset(); lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]); });

describe('HTTP status owns the relay failure category', () => {
  for (const row of fixture.statusRows) {
    it(row.id+' classifier', () => {
      // A classifier primitive: acceptance of 2xx does not claim a body exists on HTTP 204.
      const { subject } = driver();
      const classify = () => (subject as unknown as { assertLive(status: number, body: string, detaching: boolean): void }).assertLive(row.status, row.body, row.operation === 'detach');
      if (row.expected === 'success') expect(classify).not.toThrow();
      else {
        let caught: unknown;
        try { classify(); } catch (error) { caught = error; }
        expect((caught as Error | undefined)?.constructor.name).toBe(row.expected);
        expect((caught as Error).message).not.toContain('PRIVATE-B3');
      }
    });
  }
  for (const row of fixture.statusRows.filter((r: { status: number; body: string }) => [401,409,410].includes(r.status) && r.body !== 'PRIVATE-B3-not-session_gone')) {
    it(row.id+' actual callsite', async () => {
      const counts = { posts: 0, streams: 0 };
      const subject = new SsePostRelayTransport({
        post: async () => { counts.posts++; return { status: row.operation === 'stream' ? 200 : row.status, body: row.body }; },
        stream: async () => { counts.streams++; return { status: row.status, chunks: (async function* () { yield rpc; })() }; },
      }, { allowedRelayHosts: ['8.8.8.8'], egressProxy: 'http://proxy.fixture:3128' });
      const action = row.operation === 'detach' ? subject.detach(attachment('https://8.8.8.8')) :
        row.operation === 'notify' ? subject.notify(attachment('https://8.8.8.8'), frame) : subject.exchange(attachment('https://8.8.8.8'), frame);
      let caught: unknown; try { await action; } catch (error) { caught = error; }
      expect(caught instanceof Error ? caught.constructor.name : 'success').toBe(row.expected);
      expect(counts).toEqual({ posts: 1, streams: row.operation === 'stream' ? 1 : 0 });
      expect(lookup).not.toHaveBeenCalled();
    });
  }
});

describe('local DNS preflight complements the required proxy', () => {
  for (const profile of fixture.dnsProfiles) {
    it(profile.id, async () => {
      const { subject, counts } = driver({
        allowedRelayHosts: profile.allowedHosts ?? ['relay.fixture.invalid'],
        allowedRelayPorts: profile.allowedPorts ?? [443],
        egressProxy: profile.proxy === null ? null : 'http://proxy.fixture:3128',
        allowUnverifiedEgress: profile.allowUnverified ?? false,
      });
      let index = 0;
      lookup.mockImplementation(async (_host: string, options: { all: boolean }) => {
        expect(options.all).toBe(true);
        const answer = profile.answers[Math.min(index++, profile.answers.length - 1)];
        if (answer === false) throw new Error('PRIVATE-B3-DNS');
        return answer.map((address: string) => ({ address, family: address.includes(':') ? 6 : 4 }));
      });
      const action = subject.exchange(attachment(profile.url, profile.allowInsecureLoopback), frame);
      if (profile.expectedPublic) await expect(action).resolves.toMatchObject({ result: { fixture: true } });
      else await expect(action).rejects.toThrowError(AttachmentUnauthorized);
      expect(counts).toEqual({ posts: profile.expectedPosts ?? (profile.expectedPublic ? 1 : 0), streams: profile.expectedStreams ?? (profile.expectedPublic ? 1 : 0) });
      const expectedLookups = profile.expectedDnsCalls ?? (profile.id === 'dns-rebind-before-get' ? 2 : profile.expectedPublic ? 2 : 1);
      expect(lookup).toHaveBeenCalledTimes(expectedLookups);
    });
  }
  for (const row of fixture.addresses) {
    it('literal '+row.id+' never does DNS', async () => {
      const host = row.address.includes(':') ? '['+row.address+']' : row.address;
      const { subject, counts } = driver({ allowedRelayHosts: [host, row.address, new URL('https://'+host).hostname] });
      const action = subject.exchange(attachment('https://'+host), frame);
      if (row.publicAddress ?? row.expectedPublic) await expect(action).resolves.toMatchObject({ result: { fixture: true } });
      else await expect(action).rejects.toThrowError(AttachmentUnauthorized);
      expect(lookup).not.toHaveBeenCalled();
      expect(counts.posts).toBe((row.publicAddress ?? row.expectedPublic) ? 1 : 0);
    });
  }
  it('waits for native resolution before invoking HTTP', async () => {
    let resolve!: (value: { address: string; family: number }[]) => void;
    lookup.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const { subject, counts } = driver();
    const pending = subject.exchange(attachment(), frame);
    await Promise.resolve(); await Promise.resolve();
    const before = { ...counts };
    resolve?.([{ address: '8.8.8.8', family: 4 }]);
    await pending;
    expect(before).toEqual({ posts: 0, streams: 0 });
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  it.each(['notify', 'detach'] as const)('preflights %s before any HTTP', async (operation) => {
    lookup.mockRejectedValue(new Error('PRIVATE-B3-DNS'));
    const { subject, counts } = driver();
    await expect(operation === 'notify' ? subject.notify(attachment(), frame) : subject.detach(attachment())).rejects.toThrowError(AttachmentUnauthorized);
    expect(counts).toEqual({ posts: 0, streams: 0 });
  });
});
