import { createTimeline, rtmCall, RtmError, type RtmCallOptions, type RtmCredentials } from './client';
import { toArray } from './read';
import type { RtmParams } from './signature';

/** The three ids that address one task. They come from `getTasks` or from `addTask`. */
export interface TaskRef {
  listId: string;
  taskseriesId: string;
  taskId: string;
}

/** Options of every change call. Pass a `timeline` to reuse one across several changes. */
export interface WriteOptions extends RtmCallOptions {
  timeline?: string;
}

/** What a change call reports back. `transactionId` can be used to undo the change in RTM. */
export interface WriteResult {
  transactionId: string;
  rsp: Record<string, unknown>;
}

/**
 * Runs one change call: creates a timeline when none is given, sends the call and extracts the
 * transaction id.
 *
 * Offers: the shared plumbing of all change operations below.
 */
async function write(
  creds: RtmCredentials,
  method: string,
  params: RtmParams,
  options: WriteOptions,
): Promise<WriteResult> {
  const timeline = options.timeline ?? (await createTimeline(creds, options));
  const rsp = await rtmCall(creds, method, { ...params, timeline }, options);
  const transaction = rsp.transaction as { id?: unknown } | undefined;
  return { transactionId: transaction?.id == null ? '' : String(transaction.id), rsp };
}

/** The ids as request parameters. */
const refParams = (ref: TaskRef): RtmParams => ({
  list_id: ref.listId,
  taskseries_id: ref.taskseriesId,
  task_id: ref.taskId,
});

/** Throws a usage error (before any network call) when `ok` is false. */
function require_(ok: boolean, message: string): void {
  if (!ok) throw new RtmError('usage', message);
}

/**
 * Adds a task. The name is taken literally: smart-add parsing is switched off (`parse=0`), so
 * characters such as ^ # @ in a mail subject do not turn into dates or tags.
 *
 * @returns The new task's ids, so follow-up changes (tags, notes, URL) can address it.
 */
export async function addTask(
  creds: RtmCredentials,
  name: string,
  listId: string | undefined,
  options: WriteOptions = {},
): Promise<WriteResult & { ref: TaskRef }> {
  require_(name.trim() !== '', 'Task name must not be empty');
  const result = await write(creds, 'rtm.tasks.add', { name, list_id: listId, parse: '0' }, options);
  const list = result.rsp.list as { id?: unknown; taskseries?: unknown } | undefined;
  const series = toArray<{ id?: unknown; task?: unknown }>(list?.taskseries)[0];
  const task = toArray<{ id?: unknown }>(series?.task)[0];
  if (!list || !series || !task) throw new RtmError('parse', 'Remember The Milk returned no task ids');
  return { ...result, ref: { listId: String(list.id), taskseriesId: String(series.id), taskId: String(task.id) } };
}

/**
 * Sets or clears the due date.
 *
 * @param due `YYYY-MM-DD` (read in the RTM user's time zone), or `undefined` to remove the date.
 */
export async function setDueDate(creds: RtmCredentials, ref: TaskRef, due: string | undefined, options: WriteOptions = {}): Promise<WriteResult> {
  require_(due === undefined || /^\d{4}-\d{2}-\d{2}$/.test(due), 'Due date must look like YYYY-MM-DD');
  return write(creds, 'rtm.tasks.setDueDate', { ...refParams(ref), due, parse: due === undefined ? undefined : '1' }, options);
}

/** Sets the priority: "1", "2" or "3", or "N" for none. */
export async function setPriority(creds: RtmCredentials, ref: TaskRef, priority: '1' | '2' | '3' | 'N', options: WriteOptions = {}): Promise<WriteResult> {
  require_(['1', '2', '3', 'N'].includes(priority), 'Priority must be 1, 2, 3 or N');
  // RTM removes the priority when the parameter is left out.
  return write(creds, 'rtm.tasks.setPriority', { ...refParams(ref), priority: priority === 'N' ? undefined : priority }, options);
}

/** Checks a tag list and joins it the way RTM wants it (comma separated). */
function joinTags(tags: string[]): string {
  require_(tags.length > 0, 'Give at least one tag');
  require_(tags.every((t) => t.trim() !== '' && !t.includes(',')), 'Tags must not be empty or contain a comma');
  return tags.join(',');
}

/** Adds tags to a task. */
export async function addTags(creds: RtmCredentials, ref: TaskRef, tags: string[], options: WriteOptions = {}): Promise<WriteResult> {
  return write(creds, 'rtm.tasks.addTags', { ...refParams(ref), tags: joinTags(tags) }, options);
}

/** Removes tags from a task. */
export async function removeTags(creds: RtmCredentials, ref: TaskRef, tags: string[], options: WriteOptions = {}): Promise<WriteResult> {
  return write(creds, 'rtm.tasks.removeTags', { ...refParams(ref), tags: joinTags(tags) }, options);
}

/** Moves a task to another list. */
export async function moveTask(creds: RtmCredentials, ref: TaskRef, toListId: string, options: WriteOptions = {}): Promise<WriteResult> {
  require_(toListId !== '', 'Target list id must not be empty');
  return write(creds, 'rtm.tasks.moveTo', {
    from_list_id: ref.listId,
    to_list_id: toListId,
    taskseries_id: ref.taskseriesId,
    task_id: ref.taskId,
  }, options);
}

/** Marks a task as completed. */
export async function completeTask(creds: RtmCredentials, ref: TaskRef, options: WriteOptions = {}): Promise<WriteResult> {
  return write(creds, 'rtm.tasks.complete', refParams(ref), options);
}

/** Deletes a task (needs the "delete" permission). */
export async function deleteTask(creds: RtmCredentials, ref: TaskRef, options: WriteOptions = {}): Promise<WriteResult> {
  return write(creds, 'rtm.tasks.delete', refParams(ref), options);
}

/** Adds a note to a task. */
export async function addNote(creds: RtmCredentials, ref: TaskRef, title: string, text: string, options: WriteOptions = {}): Promise<WriteResult> {
  require_(text.trim() !== '', 'Note text must not be empty');
  return write(creds, 'rtm.tasks.notes.add', { ...refParams(ref), note_title: title, note_text: text }, options);
}

/** Sets (or, with an empty value, clears) the URL of a task. */
export async function setUrl(creds: RtmCredentials, ref: TaskRef, url: string | undefined, options: WriteOptions = {}): Promise<WriteResult> {
  return write(creds, 'rtm.tasks.setURL', { ...refParams(ref), url: url || undefined }, options);
}

/** Creates a list and returns its id. */
export async function addList(creds: RtmCredentials, name: string, options: WriteOptions = {}): Promise<WriteResult & { listId: string }> {
  require_(name.trim() !== '', 'List name must not be empty');
  const result = await write(creds, 'rtm.lists.add', { name }, options);
  const list = result.rsp.list as { id?: unknown } | undefined;
  if (!list || list.id == null) throw new RtmError('parse', 'Remember The Milk returned no list id');
  return { ...result, listId: String(list.id) };
}
