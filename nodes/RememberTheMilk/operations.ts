import type { IDataObject } from 'n8n-workflow';
import type { RtmCallOptions, RtmCredentials } from './client';
import { RtmError } from './client';
import { getLists, getTasks } from './read';
import {
  addList, addNote, addTags, addTask, completeTask, deleteTask, moveTask, removeTags,
  setDueDate, setPriority, setUrl, type TaskRef,
} from './write';

/** Reads one node parameter by name (the node passes `this.getNodeParameter(name, itemIndex)`). */
export type ParamGetter = (name: string) => unknown;

/** Splits "a, b ,c" into ["a","b","c"], dropping empty parts. */
export function splitTags(text: string): string[] {
  return text.split(',').map((t) => t.trim()).filter((t) => t !== '');
}

/**
 * Runs one operation of the node for one input item and returns the output rows.
 *
 * Offers: the mapping from the node's resource/operation/parameters to the API functions,
 * kept apart from n8n so it can be tested with a fake RTM.
 *
 * @throws RtmError for API problems and unknown operations.
 */
export async function executeOperation(
  creds: RtmCredentials,
  resource: string,
  operation: string,
  get: ParamGetter,
  options: RtmCallOptions = {},
): Promise<IDataObject[]> {
  const text = (name: string): string => String(get(name) ?? '');
  const ref = (): TaskRef => ({ listId: text('listId'), taskseriesId: text('taskseriesId'), taskId: text('taskId') });
  /** Result row of a change: the task ids plus the transaction id. */
  const changed = (r: TaskRef, transactionId: string): IDataObject[] => [{ ...r, transactionId }];

  // Block: list resource.
  if (resource === 'list') {
    if (operation === 'getAll') return (await getLists(creds, options)) as unknown as IDataObject[];
    if (operation === 'add') {
      const r = await addList(creds, text('listName'), options);
      return [{ listId: r.listId, transactionId: r.transactionId }];
    }
  }

  // Block: task resource.
  if (resource === 'task') {
    switch (operation) {
      case 'getAll':
        return (await getTasks(creds, { filter: text('filter') || undefined, listId: text('restrictListId') || undefined }, options)) as unknown as IDataObject[];
      case 'add': {
        const r = await addTask(creds, text('name'), text('targetListId') || undefined, options);
        return changed(r.ref, r.transactionId);
      }
      case 'setDueDate':
        return changed(ref(), (await setDueDate(creds, ref(), text('dueDate') || undefined, options)).transactionId);
      case 'setPriority':
        return changed(ref(), (await setPriority(creds, ref(), text('priority') as '1' | '2' | '3' | 'N', options)).transactionId);
      case 'addTags':
        return changed(ref(), (await addTags(creds, ref(), splitTags(text('tags')), options)).transactionId);
      case 'removeTags':
        return changed(ref(), (await removeTags(creds, ref(), splitTags(text('tags')), options)).transactionId);
      case 'move':
        return changed(ref(), (await moveTask(creds, ref(), text('targetListId'), options)).transactionId);
      case 'complete':
        return changed(ref(), (await completeTask(creds, ref(), options)).transactionId);
      case 'delete':
        return changed(ref(), (await deleteTask(creds, ref(), options)).transactionId);
      case 'addNote':
        return changed(ref(), (await addNote(creds, ref(), text('noteTitle'), text('noteText'), options)).transactionId);
      case 'setUrl':
        return changed(ref(), (await setUrl(creds, ref(), text('url') || undefined, options)).transactionId);
    }
  }
  throw new RtmError('usage', `Unknown operation: ${resource}/${operation}`);
}
