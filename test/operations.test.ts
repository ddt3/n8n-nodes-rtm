import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../nodes/RememberTheMilk/client';
import { executeOperation, splitTags } from '../nodes/RememberTheMilk/operations';
import { RememberTheMilk } from '../nodes/RememberTheMilk/RememberTheMilk.node';

// Tests for the node form and its mapping to the API (Feature D / Step 3).
const creds = { apiKey: ['key', 'A1b2'].join(''), sharedSecret: ['sec', 'X9y8'].join('') };
const ids = { listId: '10', taskseriesId: '20', taskId: '30' };

function fake() {
  const sent: URLSearchParams[] = [];
  const fetchImpl: FetchLike = async (_u, init) => {
    const body = new URLSearchParams(init.body);
    sent.push(body);
    const method = body.get('method');
    const rsp: Record<string, unknown> = { stat: 'ok', transaction: { id: 'TX' } };
    if (method === 'rtm.timelines.create') rsp.timeline = 'T1';
    if (method === 'rtm.tasks.add') rsp.list = { id: '10', taskseries: [{ id: '20', task: [{ id: '30' }] }] };
    if (method === 'rtm.lists.add') rsp.list = { id: '77' };
    if (method === 'rtm.lists.getList') rsp.lists = { list: [{ id: '1', name: 'Inbox' }] };
    if (method === 'rtm.tasks.getList') rsp.tasks = { list: [{ id: '10', taskseries: [{ id: '20', name: 'A', task: [{ id: '30' }] }] }] };
    return { ok: true, status: 200, text: async () => JSON.stringify({ rsp }) };
  };
  return { fetchImpl, sent };
}

/** Runs an operation with the given parameter values; records which parameters were read. */
async function run(resource: string, operation: string, values: Record<string, unknown>) {
  const f = fake();
  const read: string[] = [];
  const rows = await executeOperation(creds, resource, operation, (n) => { read.push(n); return values[n] ?? ''; }, { fetchImpl: f.fetchImpl });
  return { rows, read, sent: f.sent };
}

const cases: Array<[string, string, Record<string, unknown>, string]> = [
  ['list', 'getAll', {}, 'rtm.lists.getList'],
  ['list', 'add', { listName: 'Herinneringen' }, 'rtm.lists.add'],
  ['task', 'getAll', { filter: 'tag:idee' }, 'rtm.tasks.getList'],
  ['task', 'add', { name: 'x', targetListId: '10' }, 'rtm.tasks.add'],
  ['task', 'setDueDate', { ...ids, dueDate: '2026-11-12' }, 'rtm.tasks.setDueDate'],
  ['task', 'setPriority', { ...ids, priority: '1' }, 'rtm.tasks.setPriority'],
  ['task', 'addTags', { ...ids, tags: 'a, b' }, 'rtm.tasks.addTags'],
  ['task', 'removeTags', { ...ids, tags: 'a' }, 'rtm.tasks.removeTags'],
  ['task', 'move', { ...ids, targetListId: '99' }, 'rtm.tasks.moveTo'],
  ['task', 'complete', ids, 'rtm.tasks.complete'],
  ['task', 'delete', ids, 'rtm.tasks.delete'],
  ['task', 'addNote', { ...ids, noteTitle: 't', noteText: 'body' }, 'rtm.tasks.notes.add'],
  ['task', 'setUrl', { ...ids, url: 'https://x.test' }, 'rtm.tasks.setURL'],
];

describe('executeOperation', () => {
  it.each(cases)('%s/%s calls the matching RTM method', async (resource, operation, values, method) => {
    const r = await run(resource, operation, values);
    expect(r.sent[r.sent.length - 1].get('method')).toBe(method);
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it('change operations return the ids and the transaction id', async () => {
    expect((await run('task', 'complete', ids)).rows).toEqual([{ ...ids, transactionId: 'TX' }]);
  });

  it('add returns the new ids; empty target list means Inbox (no list_id sent)', async () => {
    const r = await run('task', 'add', { name: 'x', targetListId: '' });
    expect(r.rows[0]).toMatchObject(ids);
    expect(r.sent[r.sent.length - 1].has('list_id')).toBe(false);
  });

  it('rejects an unknown operation', async () => {
    await expect(run('task', 'explode', {})).rejects.toMatchObject({ code: 'usage' });
  });

  it('splitTags trims and drops empties', () => {
    expect(splitTags(' a, b ,, c ')).toEqual(['a', 'b', 'c']);
  });
});

describe('node form', () => {
  const props = new RememberTheMilk().description.properties;

  it('has an explicit default on every parameter', () => {
    for (const p of props) expect(p.default, p.name).not.toBeUndefined();
  });

  it('shows every parameter an operation reads, for exactly that resource and operation', async () => {
    const visible = (name: string, resource: string, operation: string) =>
      props.some((p) => {
        if (p.name !== name) return false;
        const show = p.displayOptions?.show ?? {};
        return (!show.resource || show.resource.includes(resource)) && (!show.operation || show.operation.includes(operation));
      });
    for (const [resource, operation, values] of cases) {
      const r = await run(resource, operation, values);
      for (const name of r.read) expect(visible(name, resource, operation), `${resource}/${operation} reads ${name}`).toBe(true);
    }
  });

  it('offers every operation that executeOperation supports', () => {
    const offered = props.filter((p) => p.name === 'operation').flatMap((p) => (p.options as Array<{ value: string }>).map((o) => o.value));
    for (const [, operation] of cases) expect(offered).toContain(operation);
  });
});
