import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { RememberTheMilk } from '../nodes/RememberTheMilk/RememberTheMilk.node';

// The default transport talks to the real network; these tests stub `fetch`, so route the transport through it.
vi.mock('../nodes/RememberTheMilk/transport', () => ({
  CONNECT_FAILED: 'RTM_CONNECT_FAILED',
  createTransport: () => (url: string, init: object) => (globalThis.fetch as unknown as (u: string, i: object) => Promise<never>)(url, init),
}));

// Tests for the node identity (Feature A / Step 1) and execution (Feature D / Step 3).
describe('RememberTheMilk node', () => {
  const node = new RememberTheMilk();

  it('declares the identity n8n needs to list the node', () => {
    // Block: the fields n8n uses to show and load the node.
    expect(node.description.name).toBe('rememberTheMilk');
    expect(node.description.displayName).toBe('Remember The Milk');
    expect(node.description.icon).toBe('file:rtm.svg');
    expect(node.description.version).toBe(1);
  });

  it('has one main input and one main output', () => {
    expect(node.description.inputs).toHaveLength(1);
    expect(node.description.outputs).toHaveLength(1);
  });

  // Block: execute() with a fake n8n context and a stubbed network.
  const secret = ['sec', 'X9y8', 'Z7w6'].join('');
  const context = (params: Record<string, unknown>, items: INodeExecutionData[], continueOnFail = false) =>
    ({
      getInputData: () => items,
      getCredentials: async () => ({ apiKey: ['key', 'A1b2'].join(''), sharedSecret: secret, authToken: ['tok', 'Q1w2'].join('') }),
      getNodeParameter: (name: string, _i: number, fallback?: unknown) => params[name] ?? fallback,
      continueOnFail: () => continueOnFail,
      getNode: () => ({ name: 'Remember The Milk' }),
    }) as unknown as IExecuteFunctions;
  const stubFetch = (rsp: object) =>
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ rsp }) }));
  afterEach(() => vi.unstubAllGlobals());

  it('returns one output row per result, paired with its input item', async () => {
    stubFetch({ stat: 'ok', lists: { list: [{ id: '1', name: 'Inbox' }, { id: '2', name: 'Privé' }] } });
    const [out] = await node.execute.call(context({ resource: 'list', operation: 'getAll' }, [{ json: {} }]));
    expect(out.map((o) => o.json.name)).toEqual(['Inbox', 'Privé']);
    expect(out[0].pairedItem).toEqual({ item: 0 });
  });

  it('stops with a credential-free error by default', async () => {
    stubFetch({ stat: 'fail', err: { code: '98', msg: `Login failed ${secret}` } });
    const run = node.execute.call(context({ resource: 'list', operation: 'getAll' }, [{ json: {} }]));
    await expect(run).rejects.toThrow('Login failed');
    await expect(run).rejects.not.toThrow(secret);
  });

  it('turns an error into an error field on that item with Continue On Fail', async () => {
    stubFetch({ stat: 'fail', err: { code: '98', msg: 'Login failed' } });
    const [out] = await node.execute.call(context({ resource: 'list', operation: 'getAll' }, [{ json: {} }], true));
    expect(out).toHaveLength(1);
    expect(String(out[0].json.error)).toContain('Login failed');
  });
});
