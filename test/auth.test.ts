import { describe, expect, it } from 'vitest';
import { buildAuthUrl, getFrob, getToken, runAuthorizeCli } from '../nodes/RememberTheMilk/auth';
import type { FetchLike } from '../nodes/RememberTheMilk/client';
import { signRequest } from '../nodes/RememberTheMilk/signature';

// Tests for the authorisation helper (Feature C). Fake credentials are built at run time.
const creds = { apiKey: ['key', 'A1b2', 'C3d4'].join(''), sharedSecret: ['sec', 'X9y8', 'Z7w6'].join('') };
const frob = 'frob123';
const tokenValue = ['tok', 'Q1w2', 'E3r4'].join('');

/** Fake fetch answering per RTM method. */
function fake(answers: Record<string, object>) {
  const sent: URLSearchParams[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    const body = new URLSearchParams(init.body);
    sent.push(body);
    const answer = answers[body.get('method') ?? ''] ?? { stat: 'fail', err: { code: '112', msg: 'Method not found' } };
    return { ok: true, status: 200, text: async () => JSON.stringify({ rsp: answer }) };
  };
  return { fetchImpl, sent };
}
const answers = {
  'rtm.auth.getFrob': { stat: 'ok', frob },
  'rtm.auth.getToken': { stat: 'ok', auth: { token: tokenValue, perms: 'delete', user: { username: 'dries' } } },
};

describe('auth helpers', () => {
  it('getFrob returns the frob and sends no auth token', async () => {
    const { fetchImpl, sent } = fake(answers);
    expect(await getFrob({ ...creds, authToken: 'old' }, { fetchImpl })).toBe(frob);
    expect(sent[0].has('auth_token')).toBe(false);
  });

  it('buildAuthUrl is signed over api_key, perms and frob and holds no secret', () => {
    const url = new URL(buildAuthUrl(creds, frob, 'delete'));
    expect(url.origin + url.pathname).toBe('https://www.rememberthemilk.com/services/auth/');
    const q = Object.fromEntries(url.searchParams);
    const { api_sig, ...rest } = q;
    expect(rest).toEqual({ api_key: creds.apiKey, perms: 'delete', frob });
    expect(api_sig).toBe(signRequest(creds.sharedSecret, rest));
    expect(url.toString()).not.toContain(creds.sharedSecret);
  });

  it('buildAuthUrl rejects an unknown permission', () => {
    expect(() => buildAuthUrl(creds, frob, 'admin')).toThrow('Permission must be');
  });

  it('getToken returns token, perms and username', async () => {
    const { fetchImpl, sent } = fake(answers);
    expect(await getToken(creds, frob, { fetchImpl })).toEqual({ token: tokenValue, perms: 'delete', username: 'dries' });
    expect(sent[0].get('frob')).toBe(frob);
  });

  it('getToken fails when RTM has not been approved yet', async () => {
    const { fetchImpl } = fake({ 'rtm.auth.getToken': { stat: 'fail', err: { code: '101', msg: 'Invalid frob' } } });
    await expect(getToken(creds, frob, { fetchImpl })).rejects.toThrow('Invalid frob');
  });
});

describe('runAuthorizeCli', () => {
  const run = async (argv: string[], env: Record<string, string | undefined>, a: Record<string, object> = answers) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runAuthorizeCli(argv, {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      env,
      options: { fetchImpl: fake(a).fetchImpl },
    });
    return { code, out, err };
  };
  const env = { RTM_API_KEY: creds.apiKey, RTM_SHARED_SECRET: creds.sharedSecret };

  it('start prints the URL and the finish command, never the secret', async () => {
    const r = await run(['start'], env);
    expect(r.code).toBe(0);
    expect(r.out.join('\n')).toContain(`finish ${frob}`);
    expect(r.out.join('\n')).toContain('perms=delete');
    expect(r.out.join('\n')).not.toContain(creds.sharedSecret);
  });

  it('finish prints the token', async () => {
    const r = await run(['finish', frob], env);
    expect(r.code).toBe(0);
    expect(r.out.join('\n')).toContain(tokenValue);
  });

  it('refuses to run without the environment settings and names only the variables', async () => {
    const r = await run(['start'], {});
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toContain('RTM_API_KEY');
  });

  it('shows usage for an unknown command', async () => {
    expect((await run(['nope'], env)).code).toBe(2);
  });

  it('reports API errors with exit code 1 and without secrets', async () => {
    const r = await run(['finish', frob], env, { 'rtm.auth.getToken': { stat: 'fail', err: { code: '101', msg: `Invalid ${creds.sharedSecret}` } } });
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).not.toContain(creds.sharedSecret);
  });
});
