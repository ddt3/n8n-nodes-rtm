import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONNECT_FAILED, createTransport } from '../nodes/RememberTheMilk/transport';

// Tests for the default transport (Feature F / Step 1): all addresses of a host are tried in turn.
let server: http.Server;
let port: number;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => res.writeHead(200).end(`echo:${req.method}:${body}`));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** Lookup that answers a fixed address list (what a host with several A records looks like). */
const lookupOf = (addrs: string[]) => ((_h: string, _o: unknown, cb: (...a: unknown[]) => void) =>
  cb(null, addrs.map((address) => ({ address, family: 4 })))) as never;

describe('createTransport', () => {
  it('POSTs the body and returns status and text', async () => {
    const t = createTransport({ lookup: lookupOf(['127.0.0.1']) });
    const r = await t(`http://rtm.test:${port}/x`, { method: 'POST', headers: {}, body: 'a=1' });
    expect(r.ok).toBe(true);
    expect(await r.text()).toBe('echo:POST:a=1');
  });

  it('skips a dead first address and succeeds on the next one, within a few seconds', async () => {
    // 10.255.255.1 does not answer (hangs or is unreachable); the second address is the working one.
    const t = createTransport({ lookup: lookupOf(['10.255.255.1', '127.0.0.1']), attemptTimeoutMs: 300 });
    const started = Date.now();
    const r = await t(`http://rtm.test:${port}/x`, { method: 'POST', headers: {}, body: 'b=2' });
    expect(await r.text()).toBe('echo:POST:b=2');
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('reports a safe, retryable code when no address can be reached', async () => {
    const t = createTransport({ lookup: lookupOf(['127.0.0.1']), attemptTimeoutMs: 300 });
    await expect(t('http://rtm.test:1/x', { method: 'POST', headers: {}, body: '' })).rejects.toMatchObject({ code: CONNECT_FAILED });
  });

  it('honours the abort signal while waiting for an answer', async () => {
    // A server that accepts the request but never answers.
    const silent = http.createServer(() => undefined);
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const silentPort = (silent.address() as AddressInfo).port;
    try {
      const t = createTransport({ lookup: lookupOf(['127.0.0.1']) });
      await expect(
        t(`http://rtm.test:${silentPort}/x`, { method: 'POST', headers: {}, body: '', signal: AbortSignal.timeout(200) }),
      ).rejects.toMatchObject({ name: 'TimeoutError' });
    } finally {
      silent.closeAllConnections();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });
});
