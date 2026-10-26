import { describe, expect, it } from 'vitest';
import { createTimeline, redact, RtmError, rtmCall, type FetchLike } from '../nodes/RememberTheMilk/client';
import { signRequest } from '../nodes/RememberTheMilk/signature';

// Tests for the signed request helper (Feature B / Step 3).
// Fake credentials are built at run time so no secret-looking literal sits in the source.
const creds = {
  apiKey: ['key', 'A1b2', 'C3d4', 'E5f6'].join(''),
  sharedSecret: ['sec', 'X9y8', 'Z7w6', 'V5u4'].join(''),
  authToken: ['tok', 'Q1w2', 'E3r4', 'T5y6'].join(''),
};
const all = [creds.apiKey, creds.sharedSecret, creds.authToken];

/** Fake fetch that records the request and answers with the given body/status. */
function fake(body: string, status = 200) {
  const calls: Array<{ url: string; body: string; method: string }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body, method: init.method });
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  return { fetchImpl, calls };
}
const ok = (extra: object = {}) => JSON.stringify({ rsp: { stat: 'ok', ...extra } });

describe('rtmCall request', () => {
  it('signs a POST whose body carries method, key, token, format and a valid api_sig', async () => {
    const { fetchImpl, calls } = fake(ok());
    await rtmCall(creds, 'rtm.test.echo', { name: 'value' }, { fetchImpl });
    const sent = new URLSearchParams(calls[0].body);
    expect(calls[0].method).toBe('POST');
    expect(sent.get('method')).toBe('rtm.test.echo');
    expect(sent.get('api_key')).toBe(creds.apiKey);
    expect(sent.get('auth_token')).toBe(creds.authToken);
    expect(sent.get('format')).toBe('json');
    const { api_sig, ...rest } = Object.fromEntries(sent);
    expect(api_sig).toBe(signRequest(creds.sharedSecret, rest));
  });

  it('never sends the shared secret and never puts parameters in the URL', async () => {
    const { fetchImpl, calls } = fake(ok());
    await rtmCall(creds, 'rtm.test.echo', {}, { fetchImpl });
    expect(calls[0].body).not.toContain(creds.sharedSecret);
    expect(calls[0].url).toBe('https://api.rememberthemilk.com/services/rest/');
  });

  it('leaves out auth_token when there is none', async () => {
    const { fetchImpl, calls } = fake(ok());
    await rtmCall({ apiKey: creds.apiKey, sharedSecret: creds.sharedSecret }, 'rtm.auth.getFrob', {}, { fetchImpl });
    expect(new URLSearchParams(calls[0].body).has('auth_token')).toBe(false);
  });
});

describe('rtmCall answers', () => {
  it('returns the rsp object on success', async () => {
    const { fetchImpl } = fake(ok({ frob: 'abc' }));
    expect((await rtmCall(creds, 'rtm.auth.getFrob', {}, { fetchImpl })).frob).toBe('abc');
  });

  it('turns an API failure into an RtmError with the RTM code', async () => {
    const { fetchImpl } = fake(JSON.stringify({ rsp: { stat: 'fail', err: { code: '98', msg: 'Login failed' } } }));
    const error = await rtmCall(creds, 'rtm.tasks.getList', {}, { fetchImpl }).catch((e) => e as RtmError);
    expect(error).toBeInstanceOf(RtmError);
    expect(error.code).toBe('rtm:98');
    expect(error.message).toContain('Login failed');
  });

  it('turns HTTP errors, bad JSON and a missing rsp into RtmErrors', async () => {
    const codes: string[] = [];
    for (const f of [fake('x', 503), fake('not json'), fake('{}')]) {
      codes.push(((await rtmCall(creds, 'm', {}, { fetchImpl: f.fetchImpl }).catch((e) => e)) as RtmError).code);
    }
    expect(codes).toEqual(['http:503', 'parse', 'parse']);
  });
});

describe('leak safety', () => {
  it('redact replaces every secret and ignores empty values', () => {
    expect(redact(`a ${creds.apiKey} b ${creds.apiKey} c`, [creds.apiKey, '', undefined])).toBe('a [redacted] b [redacted] c');
  });

  it('keeps credentials out of the error when RTM echoes them back', async () => {
    const echo = `bad ${creds.apiKey} ${creds.authToken} ${creds.sharedSecret}`;
    const { fetchImpl } = fake(JSON.stringify({ rsp: { stat: 'fail', err: { code: '1', msg: echo } } }));
    const error = (await rtmCall(creds, 'm', {}, { fetchImpl }).catch((e) => e)) as RtmError;
    for (const secret of all) expect(error.message).not.toContain(secret);
  });

  it('replaces transport errors (which may carry the URL and body) by a safe error', async () => {
    const fetchImpl: FetchLike = async (url, init) => {
      throw new Error(`boom ${url} ${init.body}`);
    };
    const error = (await rtmCall(creds, 'm', {}, { fetchImpl }).catch((e) => e)) as RtmError;
    expect(error.code).toBe('network');
    expect(error.cause).toBeUndefined();
    const text = `${error.message} ${error.stack ?? ''}`;
    for (const secret of all) expect(text).not.toContain(secret);
    expect(text).not.toContain('rememberthemilk.com');
  });

  it('passes on a plain error code as a hint, but nothing else from the transport error', async () => {
    const fetchImpl: FetchLike = async (url) => {
      throw Object.assign(new TypeError(`fetch failed ${url}`), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT', message: creds.apiKey } });
    };
    const error = (await rtmCall(creds, 'm', {}, { fetchImpl }).catch((e) => e)) as RtmError;
    expect(error.message).toBe('Could not reach Remember The Milk (m): UND_ERR_CONNECT_TIMEOUT');
  });

  it('drops a code that is not a plain identifier', async () => {
    const fetchImpl: FetchLike = async () => {
      throw Object.assign(new Error('x'), { cause: { code: `https://x.test/?k=${creds.apiKey}` } });
    };
    const error = (await rtmCall(creds, 'm', {}, { fetchImpl }).catch((e) => e)) as RtmError;
    expect(error.message).toBe('Could not reach Remember The Milk (m)');
  });
});

describe('connect retries', () => {
  const connectFail = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });

  it('retries when no connection could be made and then succeeds', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls++;
      if (calls < 3) throw connectFail();
      return { ok: true, status: 200, text: async () => ok() };
    };
    await rtmCall(creds, 'm', {}, { fetchImpl, retryDelayMs: 0 });
    expect(calls).toBe(3);
  });

  it('gives up after the retries and reports the code', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls++;
      throw connectFail();
    };
    const error = (await rtmCall(creds, 'm', {}, { fetchImpl, retryDelayMs: 0, connectRetries: 1 }).catch((e) => e)) as RtmError;
    expect(calls).toBe(2);
    expect(error.message).toContain('UND_ERR_CONNECT_TIMEOUT');
  });

  it('does not retry errors where the request may have been sent', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls++;
      throw Object.assign(new Error('x'), { cause: { code: 'UND_ERR_SOCKET' } });
    };
    await rtmCall(creds, 'm', {}, { fetchImpl, retryDelayMs: 0 }).catch(() => undefined);
    expect(calls).toBe(1);
  });
});

describe('createTimeline', () => {
  it('returns the timeline id', async () => {
    const { fetchImpl, calls } = fake(ok({ timeline: '12345' }));
    expect(await createTimeline(creds, { fetchImpl })).toBe('12345');
    expect(new URLSearchParams(calls[0].body).get('method')).toBe('rtm.timelines.create');
  });

  it('fails when no timeline comes back', async () => {
    const { fetchImpl } = fake(ok());
    await expect(createTimeline(creds, { fetchImpl })).rejects.toThrow('no timeline');
  });
});
