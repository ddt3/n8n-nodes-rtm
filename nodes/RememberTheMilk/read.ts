import { rtmCall, type RtmCallOptions, type RtmCredentials } from './client';

/** A list (including smart lists) as RTM reports it. */
export interface RtmList {
  id: string;
  name: string;
  smart: boolean;
  archived: boolean;
  deleted: boolean;
  locked: boolean;
}

/** A note on a task. */
export interface RtmNote {
  id: string;
  title: string;
  text: string;
}

/**
 * One task, flattened. The three ids together address the task for every change call.
 * `priority` is "N" (none), "1", "2" or "3". `due` is an ISO timestamp or "" when there is none.
 */
export interface RtmTask {
  listId: string;
  taskseriesId: string;
  taskId: string;
  name: string;
  url: string;
  tags: string[];
  notes: RtmNote[];
  due: string;
  hasDueTime: boolean;
  priority: string;
  completed: string;
  deleted: string;
  added: string;
  postponed: number;
}

/** RTM's JSON turns one-element lists into plain objects and empty ones into [] or "": undo that. */
export function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') return [value as T];
  return [];
}

const str = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value));
const flag = (value: unknown): boolean => str(value) === '1';

/**
 * Lists all lists of the user.
 *
 * @returns Every list, including smart, archived and deleted ones (filter on the flags if needed).
 */
export async function getLists(creds: RtmCredentials, options: RtmCallOptions = {}): Promise<RtmList[]> {
  const rsp = await rtmCall(creds, 'rtm.lists.getList', {}, options);
  const raw = toArray<Record<string, unknown>>((rsp.lists as { list?: unknown } | undefined)?.list);
  return raw.map((l) => ({
    id: str(l.id),
    name: str(l.name),
    smart: flag(l.smart),
    archived: flag(l.archived),
    deleted: flag(l.deleted),
    locked: flag(l.locked),
  }));
}

/** Options for {@link getTasks}. */
export interface GetTasksOptions {
  /** RTM search filter, for example `list:Inbox AND tag:idee AND status:incomplete`. */
  filter?: string;
  /** Limit to one list id. */
  listId?: string;
}

/**
 * Reads tasks, optionally filtered, and flattens RTM's list > taskseries > task nesting.
 *
 * Offers: one row per task with the three ids needed to change it later.
 */
export async function getTasks(
  creds: RtmCredentials,
  query: GetTasksOptions = {},
  options: RtmCallOptions = {},
): Promise<RtmTask[]> {
  const rsp = await rtmCall(creds, 'rtm.tasks.getList', { filter: query.filter, list_id: query.listId }, options);
  const result: RtmTask[] = [];
  for (const list of toArray<Record<string, unknown>>((rsp.tasks as { list?: unknown } | undefined)?.list)) {
    for (const series of toArray<Record<string, unknown>>(list.taskseries)) {
      // Block: series-level fields shared by every task occurrence in the series.
      const tags = toArray<string>((series.tags as { tag?: unknown } | undefined)?.tag).map(str);
      const notes = toArray<Record<string, unknown>>((series.notes as { note?: unknown } | undefined)?.note).map((n) => ({
        id: str(n.id),
        title: str(n.title),
        text: str(n.$t),
      }));
      // Block: one flattened row per task occurrence.
      for (const task of toArray<Record<string, unknown>>(series.task)) {
        result.push({
          listId: str(list.id),
          taskseriesId: str(series.id),
          taskId: str(task.id),
          name: str(series.name),
          url: str(series.url),
          tags,
          notes,
          due: str(task.due),
          hasDueTime: flag(task.has_due_time),
          priority: str(task.priority),
          completed: str(task.completed),
          deleted: str(task.deleted),
          added: str(task.added),
          postponed: Number(str(task.postponed)) || 0,
        });
      }
    }
  }
  return result;
}
