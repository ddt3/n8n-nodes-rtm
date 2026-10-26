import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../nodes/RememberTheMilk/client';
import { getLists, getTasks } from '../nodes/RememberTheMilk/read';

// Tests for reading lists and tasks (Feature D / Step 1), using answers shaped like RTM's JSON.
const creds = { apiKey: ['key', 'A1b2'].join(''), sharedSecret: ['sec', 'X9y8'].join('') };

function fake(rsp: object) {
  const sent: URLSearchParams[] = [];
  const fetchImpl: FetchLike = async (_u, init) => {
    sent.push(new URLSearchParams(init.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ rsp: { stat: 'ok', ...rsp } }) };
  };
  return { fetchImpl, sent };
}

describe('getLists', () => {
  it('maps lists and flags', async () => {
    const { fetchImpl } = fake({
      lists: { list: [
        { id: '1', name: 'Inbox', deleted: '0', locked: '1', archived: '0', smart: '0' },
        { id: '2', name: 'Privé', deleted: '0', locked: '0', archived: '0', smart: '0' },
        { id: '3', name: 'Old', deleted: '0', locked: '0', archived: '1', smart: '1' },
      ] },
    });
    const lists = await getLists(creds, { fetchImpl });
    expect(lists.map((l) => l.name)).toEqual(['Inbox', 'Privé', 'Old']);
    expect(lists[0]).toMatchObject({ locked: true, archived: false, smart: false });
    expect(lists[2]).toMatchObject({ archived: true, smart: true });
  });

  it('copes with a single list sent as an object and with none at all', async () => {
    expect((await getLists(creds, { fetchImpl: fake({ lists: { list: { id: '1', name: 'A' } } }).fetchImpl })).length).toBe(1);
    expect(await getLists(creds, { fetchImpl: fake({ lists: {} }).fetchImpl })).toEqual([]);
  });
});

describe('getTasks', () => {
  const tasks = {
    tasks: { rev: 'r', list: [
      { id: '10', taskseries: [
        { id: '20', name: 'Idee A', url: 'https://x.test', tags: { tag: ['idee', 'thuis'] },
          notes: { note: [{ id: '5', title: 't', $t: 'body text' }] },
          task: [{ id: '30', due: '2026-11-12T23:00:00Z', has_due_time: '0', added: 'a', completed: '', deleted: '', priority: '2', postponed: '1' }] },
        { id: '21', name: 'Idee B', url: '', tags: [], notes: [],
          task: { id: '31', due: '', has_due_time: '0', added: 'a', completed: '', deleted: '', priority: 'N', postponed: '0' } },
      ] },
      { id: '11' },
    ] },
  };

  it('flattens list > taskseries > task with all ids', async () => {
    const result = await getTasks(creds, {}, { fetchImpl: fake(tasks).fetchImpl });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      listId: '10', taskseriesId: '20', taskId: '30', name: 'Idee A', url: 'https://x.test',
      tags: ['idee', 'thuis'], due: '2026-11-12T23:00:00Z', priority: '2', postponed: 1, hasDueTime: false,
    });
    expect(result[0].notes).toEqual([{ id: '5', title: 't', text: 'body text' }]);
  });

  it('handles empty tags/notes, a single task object and priority N', async () => {
    const result = await getTasks(creds, {}, { fetchImpl: fake(tasks).fetchImpl });
    expect(result[1]).toMatchObject({ taskId: '31', tags: [], notes: [], priority: 'N', due: '' });
  });

  it('sends the filter and list id, and leaves them out when unset', async () => {
    const a = fake(tasks);
    await getTasks(creds, { filter: 'tag:idee', listId: '10' }, { fetchImpl: a.fetchImpl });
    expect(a.sent[0].get('filter')).toBe('tag:idee');
    expect(a.sent[0].get('list_id')).toBe('10');
    const b = fake(tasks);
    await getTasks(creds, {}, { fetchImpl: b.fetchImpl });
    expect(b.sent[0].has('filter')).toBe(false);
    expect(b.sent[0].has('list_id')).toBe(false);
  });

  it('returns an empty array when nothing matches', async () => {
    expect(await getTasks(creds, {}, { fetchImpl: fake({ tasks: { rev: 'r' } }).fetchImpl })).toEqual([]);
  });
});
