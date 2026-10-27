import { signRequest, type RtmParams } from './signature';
import { CONNECT_FAILED, createTransport } from './transport';

/** Where all RTM REST calls go. */
export const RTM_ENDPOINT = 'https://api.rememberthemilk.com/services/rest/';

/** The values needed to talk to RTM. `authToken` is optional (not needed for authorisation calls). */
export interface RtmCredentials {
  apiKey: string;
  sharedSecret: string;
  authToken?: string;
}

/** Minimal fetch shape, so tests can inject a fake instead of using the network. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Options for a call. */
export interface RtmCallOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Extra attempts when no connection could be made at all (default 2). */
  connectRetries?: number;
  /** Pause between such attempts in ms (default 500). */
  retryDelayMs?: number;
}

/**
 * Error codes that mean "the request never left": no connection was made. Retrying these is safe
 * even for calls that change data, because RTM cannot have received anything.
 */
const NOT_SENT_CODES = new Set([CONNECT_FAILED, 'UND_ERR_CONNECT_TIMEOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);

/**
 * Error raised for every failure of an RTM call.
 *
 * Offers: a stable `code` ("rtm:<code>" for API errors, "http:<status>", "network", "parse")
 * and a message that is guaranteed free of credentials and of the request URL.
 */
export class RtmError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RtmError';
    this.code = code;
  }
}

/**
 * Replaces every occurrence of a secret value in `text` by a placeholder.
 *
 * Offers: a last line of defence for text that comes from outside (API error messages).
 * Empty values are ignored so that an unset token does not blank out the whole text.
 */
export function redact(text: string, secrets: Array<string | undefined>): string {
  return secrets
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .reduce((out, secret) => out.split(secret).join('[redacted]'), text);
}

/** Default transport: tries every address of the RTM host in turn (see transport.ts). */
const defaultTransport: FetchLike = createTransport();

/**
 * Performs one signed RTM call and returns the `rsp` object of a successful answer.
 *
 * Offers: signing (api_key, auth_token, format=json, api_sig), POST with the parameters in the
 * request body (so they never appear in a URL or a proxy log), a timeout, and error handling
 * that never leaks credentials or the URL.
 *
 * @param creds   API key, shared secret and (optional) auth token.
 * @param method  RTM method name, for example `rtm.tasks.getList`.
 * @param params  Extra parameters for the method (`undefined` and `null` are left out).
 * @param options Optional injected fetch and timeout (default 30 s).
 * @throws RtmError on network, HTTP, parse and API (`stat: fail`) failures.
 */
export async function rtmCall(
  creds: RtmCredentials,
  method: string,
  params: RtmParams = {},
  options: RtmCallOptions = {},
): Promise<Record<string, unknown>> {
  const secrets = [creds.apiKey, creds.sharedSecret, creds.authToken];
  const fetchImpl: FetchLike = options.fetchImpl ?? defaultTransport;

  // Block: assemble the parameters and sign them (the signature covers everything but itself).
  const all: RtmParams = {
    ...params,
    method,
    api_key: creds.apiKey,
    auth_token: creds.authToken || undefined,
    format: 'json',
  };
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...all, api_sig: signRequest(creds.sharedSecret, all) })) {
    if (value !== undefined && value !== null) body.set(name, String(value));
  }

  // Block: send. Whatever the transport throws is replaced by a safe error (it may carry the URL).
  // A failure to connect is retried (see NOT_SENT_CODES); anything else is reported at once.
  const attempts = 1 + (options.connectRetries ?? 2);
  let response;
  for (let attempt = 1; ; attempt++) {
    try {
      response = await fetchImpl(RTM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
      break;
    } catch (error) {
      // Only a plain error code (ENOTFOUND, UND_ERR_CONNECT_TIMEOUT, TimeoutError, ...) is passed on:
      // it helps to find the cause and cannot hold the URL, the body or a credential.
      const code = String((error as { cause?: { code?: unknown } })?.cause?.code ?? (error as { code?: unknown })?.code ?? (error as Error)?.name ?? '');
      if (NOT_SENT_CODES.has(code) && attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? 500));
        continue;
      }
      const hint = /^[A-Za-z0-9_]{1,40}$/.test(code) ? `: ${code}` : '';
      throw new RtmError('network', `Could not reach Remember The Milk (${method})${hint}`);
    }
  }

  // Block: HTTP status, then JSON, then the RTM status inside the JSON.
  if (!response.ok) {
    throw new RtmError(`http:${response.status}`, `Remember The Milk answered HTTP ${response.status} (${method})`);
  }
  let rsp: Record<string, unknown>;
  try {
    rsp = (JSON.parse(await response.text()) as { rsp: Record<string, unknown> }).rsp;
    if (!rsp || typeof rsp !== 'object') throw new Error('no rsp');
  } catch {
    throw new RtmError('parse', `Remember The Milk sent an unreadable answer (${method})`);
  }
  if (rsp.stat !== 'ok') {
    const err = (rsp.err ?? {}) as { code?: unknown; msg?: unknown };
    const message = redact(String(err.msg ?? 'unknown error'), secrets);
    throw new RtmError(`rtm:${String(err.code ?? 'unknown')}`, `Remember The Milk error ${String(err.code ?? '?')}: ${message} (${method})`);
  }
  return rsp;
}

/**
 * Creates a timeline, which RTM requires for every call that changes data.
 *
 * @returns The timeline id to pass as `timeline` to write methods.
 */
export async function createTimeline(creds: RtmCredentials, options: RtmCallOptions = {}): Promise<string> {
  const rsp = await rtmCall(creds, 'rtm.timelines.create', {}, options);
  const timeline = rsp.timeline;
  if (typeof timeline !== 'string' || timeline === '') {
    throw new RtmError('parse', 'Remember The Milk returned no timeline');
  }
  return timeline;
}
