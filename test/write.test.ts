import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../nodes/RememberTheMilk/client';
import {
  addList, addNote, addTags, addTask, completeTask, deleteTask, moveTask, removeTags,
  setDueDate, setPriority, setUrl, type TaskRef,
} from '../nodes/RememberTheMilk/write';

// Tests for the change operations (Feature D / Step 2), against a fake RTM.
const creds = { apiKey: ['key', 'A1b2'].join(''), sharedSecret: ['sec', 'X9y8'].join('') };
const ref: TaskRef = { listId: '10', taskseriesId: '20', taskId: '30' };

/** Fake RTM: answers timelines and records every call; `extra` is merged into other answers. */
function fake(extra: object = {}) {
  const sent: URLSearchParams[] = [];
  const fetchImpl: FetchLike = async (_u, init) => {
    const body = new URLSearchParams(init.body);
    sent.push(body);
    const rsp = body.get('method') === 'rtm.timelines.create'
      ? { stat: 'ok', timeline: 'T1' }
      : { stat: 'ok', transaction: { id: 'TX9', undoable: '1' }, ...extra };
    return { ok: true, status: 200, text: async () => JSON.stringify({ rsp }) };
  };
  return { fetchImpl, sent };
}
const last = (s: URLSearchParams[]) => s[s.length - 1];

describe('change operations send the right call', () => {
  it('addTask: literal name (parse=0), list, timeline, and returns the new ids', async () => {
    const f = fake({ list: { id: '10', taskseries: [{ id: '20', task: [{ id: '30' }] }] } });
    const r = await addTask(creds, 'Re: offerte ^morgen #x', '10', { fetchImpl: f.fetchImpl });
    expect(f.sent.map((s) => s.get('method'))).toEqual(['rtm.timelines.create', 'rtm.tasks.add']);
    expect(last(f.sent).get('name')).toBe('Re: offerte ^morgen #x');
    expect(last(f.sent).get('parse')).toBe('0');
    expect(last(f.sent).get('list_id')).toBe('10');
    expect(last(f.sent).get('timeline')).toBe('T1');
    expect(r.ref).toEqual(ref);
    expect(r.transactionId).toBe('TX9');
  });

  it('addTask without a list leaves list_id out (RTM then uses the Inbox)', async () => {
    const f = fake({ list: { id: '1', taskseries: { id: '2', task: { id: '3' } } } });
    await addTask(creds, 'x', undefined, { fetchImpl: f.fetchImpl });
    expect(last(f.sent).has('list_id')).toBe(false);
  });

  it('setDueDate sends a parsed date, and omits it to clear', async () => {
    const f = fake();
    await setDueDate(creds, ref, '2026-11-12', { fetchImpl: f.fetchImpl });
    expect(last(f.sent).get('due')).toBe('2026-11-12');
    expect(last(f.sent).get('parse')).toBe('1');
    expect(last(f.sent).get('task_id')).toBe('30');
    await setDueDate(creds, ref, undefined, { fetchImpl: f.fetchImpl });
    expect(last(f.sent).has('due')).toBe(false);
  });

  it('setPriority sends 1-3 and omits it for none', async () => {
    const f = fake();
    await setPriority(creds, ref, '2', { fetchImpl: f.fetchImpl });
    expect(last(f.sent).get('priority')).toBe('2');
    await setPriority(creds, ref, 'N', { fetchImpl: f.fetchImpl });
    expect(last(f.sent).has('priority')).toBe(false);
  });

  it('addTags / removeTags join with commas', async () => {
    const f = fake();
    await addTags(creds, ref, ['idee', 'thuis'], { fetchImpl: f.fetchImpl });
    expect(last(f.sent).get('method')).toBe('rtm.tasks.addTags');
    expect(last(f.sent).get('tags')).toBe('idee,thuis');
    await removeTags(creds, ref, ['idee'], { fetchImpl: f.fetchImpl });
    expect(last(f.sent).get('method')).toBe('rtm.tasks.removeTags');
  });

  it('moveTask sends from and to list', async () => {
    const f = fake();
    await moveTask(creds, ref, '99', { fetchImpl: f.fetchImpl });
    expect(Object.fromEntries(last(f.sent))).toMatchObject({ from_list_id: '10', to_list_id: '99', taskseries_id: '20', task_id: '30' });
  });

  it('complete, delete, note, url use the matching methods', async () => {
    const f = fake();
    await completeTask(creds, ref, { fetchImpl: f.fetchImpl });
    expect(last(f.sent).get('method')).toBe('rtm.tasks.complete');
    await deleteTask(creds, ref, { fetchImpl: f.fetchImpl });
    expect(last(f.sent).get('method')).toBe('rtm.tasks.delete');
    await addNote(creds, ref, 'Mail', 'hele tekst', { fetchImpl: f.fetchImpl });
    expect(last(f.sent).get('method')).toBe('rtm.tasks.notes.add');
    expect(last(f.sent).get('note_text')).toBe('hele tekst');
    await setUrl(creds, ref, 'https://x.test/m', { fetchImpl: f.fetchImpl });
    expect(last(f.sent).get('url')).toBe('https://x.test/m');
  });

  it('addList returns the list id', async () => {
    const f = fake({ list: { id: '77', name: 'Herinneringen' } });
    expect((await addList(creds, 'Herinneringen', { fetchImpl: f.fetchImpl })).listId).toBe('77');
  });
});

describe('timelines', () => {
  it('creates one timeline per call by default, and none when one is passed', async () => {
    const f = fake();
    await completeTask(creds, ref, { fetchImpl: f.fetchImpl });
    expect(f.sent.filter((s) => s.get('method') === 'rtm.timelines.create')).toHaveLength(1);
    const g = fake();
    await completeTask(creds, ref, { fetchImpl: g.fetchImpl, timeline: 'KEEP' });
    expect(g.sent).toHaveLength(1);
    expect(g.sent[0].get('timeline')).toBe('KEEP');
  });
});

describe('input checks happen before any network call', () => {
  it.each([
    ['empty task name', () => addTask(creds, '  ', undefined)],
    ['bad due date', () => setDueDate(creds, ref, '12-11')],
    ['bad priority', () => setPriority(creds, ref, '4' as '1')],
    ['comma in tag', () => addTags(creds, ref, ['a,b'])],
    ['no tags', () => removeTags(creds, ref, [])],
    ['empty target list', () => moveTask(creds, ref, '')],
    ['empty note', () => addNote(creds, ref, 't', ' ')],
    ['empty list name', () => addList(creds, '')],
  ])('%s', async (_name, run) => {
    await expect(run()).rejects.toMatchObject({ code: 'usage' });
  });
});
