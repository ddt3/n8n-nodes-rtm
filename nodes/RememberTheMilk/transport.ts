import * as http from 'node:http';
import * as https from 'node:https';
import type { LookupFunction } from 'node:net';
import type { FetchLike } from './client';

/** Error code given to every failure that happened before a connection was established. */
export const CONNECT_FAILED = 'RTM_CONNECT_FAILED';

/** Options of the default transport (all optional; tests inject their own `lookup`). */
export interface TransportOptions {
  /** Name lookup; must support `all: true`. Default: the system resolver. */
  lookup?: LookupFunction;
  /** Time in ms to wait for one address before the next one is tried (default 2000). */
  attemptTimeoutMs?: number;
}

/**
 * Builds the transport used to reach RTM when no fetch is injected.
 *
 * Offers: a POST over Node's own `http(s)` module that tries ALL addresses of the host
 * (IPv6 and IPv4) one after another, each for at most `attemptTimeoutMs`. One unreachable
 * address (as happened with a dead Cloudflare edge address) therefore costs 2 s, not a failure.
 * The behaviour is set explicitly on the request, so it does not depend on process-wide
 * settings of the host application (n8n) or on the fetch implementation.
 *
 * Errors that occur before the connection exists carry the code `RTM_CONNECT_FAILED`
 * (safe to retry: nothing was sent); the original error never reaches the caller.
 */
export function createTransport(options: TransportOptions = {}): FetchLike {
  const attemptTimeout = options.attemptTimeoutMs ?? 2000;
  return (url, init) =>
    new Promise((resolve, reject) => {
      const target = new URL(url);
      const client = target.protocol === 'http:' ? http : https;
      let connected = false;
      // Block: the request. autoSelectFamily + all-address lookup = try every address in turn.
      // (autoSelectFamily* are valid net options since Node 20 but missing from the installed @types/node.)
      const requestOptions: http.RequestOptions & { autoSelectFamily: boolean; autoSelectFamilyAttemptTimeout: number } = {
          method: init.method,
          headers: { ...init.headers, 'Content-Length': Buffer.byteLength(init.body) },
          signal: init.signal,
          autoSelectFamily: true,
          autoSelectFamilyAttemptTimeout: attemptTimeout,
          lookup: options.lookup,
      };
      const req = client.request(
        target,
        requestOptions,
        (res) => {
          // Block: collect the answer text.
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('error', () => reject(Object.assign(new Error('read failed'), { code: 'ECONNRESET' })));
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            resolve({ ok: status >= 200 && status < 300, status, text: async () => Buffer.concat(chunks).toString('utf8') });
          });
        },
      );
      req.on('socket', (socket) => {
        if (!socket.connecting) connected = true;
        else socket.once('connect', () => { connected = true; });
      });
      // Block: map the failure to a plain code; only "no connection yet" is flagged as safe to retry.
      req.on('error', (error: NodeJS.ErrnoException & { name: string }) => {
        // An aborted request reports why it was aborted (TimeoutError for a timeout, like fetch does).
        const aborted = error.name === 'AbortError' || error.name === 'TimeoutError';
        const reason = aborted ? String((init.signal?.reason as Error | undefined)?.name ?? error.name) : '';
        const code = aborted ? reason : !connected ? CONNECT_FAILED : String(error.code ?? error.name);
        reject(Object.assign(new Error('request failed'), { code, name: aborted ? reason : 'Error' }));
      });
      req.end(init.body);
    });
}
