import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeProperties,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { RtmError } from './client';
import { executeOperation } from './operations';

/** Task operations that address an existing task by its three ids. */
const REF_OPERATIONS = ['setDueDate', 'setPriority', 'addTags', 'removeTags', 'move', 'complete', 'delete', 'addNote', 'setUrl'];

/** Show a parameter only for the given task operations. */
const forTask = (...operations: string[]) => ({ show: { resource: ['task'], operation: operations } });

/**
 * The three ids of a task. They default to the fields a "Get Many" or "Add" output row carries,
 * so the node can be chained after those without any mapping.
 */
const idField = (displayName: string, name: string): INodeProperties => ({
  displayName,
  name,
  type: 'string',
  default: `={{ $json.${name} }}`,
  required: true,
  displayOptions: forTask(...REF_OPERATIONS),
  description: 'Taken from the incoming item by default',
});

/**
 * Remember The Milk node.
 *
 * Offers: reading lists and tasks, and the change operations of the RTM API, using the
 * credential "Remember The Milk API". Signing and error handling live in client.ts; this file
 * only describes the form and hands each item to `executeOperation`.
 */
export class RememberTheMilk implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Remember The Milk',
    name: 'rememberTheMilk',
    icon: 'file:rtm.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{ $parameter["resource"] + ": " + $parameter["operation"] }}',
    description: 'Work with tasks in Remember The Milk',
    defaults: { name: 'Remember The Milk' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'rememberTheMilkApi', required: true }],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Task', value: 'task' },
          { name: 'List', value: 'list' },
        ],
        default: 'task',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['list'] } },
        options: [
          { name: 'Get Many', value: 'getAll', action: 'Get many lists' },
          { name: 'Add', value: 'add', action: 'Add a list' },
        ],
        default: 'getAll',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['task'] } },
        options: [
          { name: 'Get Many', value: 'getAll', action: 'Get many tasks' },
          { name: 'Add', value: 'add', action: 'Add a task' },
          { name: 'Set Due Date', value: 'setDueDate', action: 'Set the due date of a task' },
          { name: 'Set Priority', value: 'setPriority', action: 'Set the priority of a task' },
          { name: 'Add Tags', value: 'addTags', action: 'Add tags to a task' },
          { name: 'Remove Tags', value: 'removeTags', action: 'Remove tags from a task' },
          { name: 'Move', value: 'move', action: 'Move a task to another list' },
          { name: 'Complete', value: 'complete', action: 'Complete a task' },
          { name: 'Delete', value: 'delete', action: 'Delete a task' },
          { name: 'Add Note', value: 'addNote', action: 'Add a note to a task' },
          { name: 'Set URL', value: 'setUrl', action: 'Set the URL of a task' },
        ],
        default: 'getAll',
      },
      // Block: task ids (chain-friendly defaults).
      idField('List ID', 'listId'),
      idField('Task Series ID', 'taskseriesId'),
      idField('Task ID', 'taskId'),
      // Block: list operations.
      {
        displayName: 'List Name',
        name: 'listName',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { resource: ['list'], operation: ['add'] } },
      },
      // Block: Get Many tasks.
      {
        displayName: 'Filter',
        name: 'filter',
        type: 'string',
        default: '',
        placeholder: 'tag:idee AND status:incomplete',
        displayOptions: forTask('getAll'),
        description: 'RTM search filter. Empty returns every task.',
      },
      {
        displayName: 'Only In List ID',
        name: 'restrictListId',
        type: 'string',
        default: '',
        displayOptions: forTask('getAll'),
        description: 'Leave empty for all lists',
      },
      // Block: Add and Move.
      {
        displayName: 'Task Name',
        name: 'name',
        type: 'string',
        default: '',
        required: true,
        displayOptions: forTask('add'),
        description: 'Used literally: ^ # @ and similar characters are not interpreted',
      },
      {
        displayName: 'List ID',
        name: 'targetListId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: forTask('move'),
        description: 'The list to move the task to',
      },
      {
        displayName: 'List ID',
        name: 'targetListId',
        type: 'string',
        default: '',
        displayOptions: forTask('add'),
        description: 'List to add the task to. Empty uses the Inbox.',
      },
      // Block: change fields.
      {
        displayName: 'Due Date',
        name: 'dueDate',
        type: 'string',
        default: '',
        placeholder: '2026-11-12',
        displayOptions: forTask('setDueDate'),
        description: 'YYYY-MM-DD in your RTM time zone. Empty removes the due date.',
      },
      {
        displayName: 'Priority',
        name: 'priority',
        type: 'options',
        options: [
          { name: 'None', value: 'N' },
          { name: '1 (High)', value: '1' },
          { name: '2 (Medium)', value: '2' },
          { name: '3 (Low)', value: '3' },
        ],
        default: 'N',
        displayOptions: forTask('setPriority'),
      },
      {
        displayName: 'Tags',
        name: 'tags',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'idee, thuis',
        displayOptions: forTask('addTags', 'removeTags'),
        description: 'Comma-separated',
      },
      {
        displayName: 'Note Title',
        name: 'noteTitle',
        type: 'string',
        default: '',
        displayOptions: forTask('addNote'),
      },
      {
        displayName: 'Note Text',
        name: 'noteText',
        type: 'string',
        typeOptions: { rows: 4 },
        default: '',
        required: true,
        displayOptions: forTask('addNote'),
      },
      {
        displayName: 'URL',
        name: 'url',
        type: 'string',
        default: '',
        displayOptions: forTask('setUrl'),
        description: 'Empty removes the URL',
      },
    ],
  };

  /**
   * Runs the chosen operation once per input item.
   * Errors carry only RtmError's credential-free message; with "Continue On Fail" they become
   * an `error` field on that item instead of stopping the run.
   */
  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const output: INodeExecutionData[] = [];
    const stored = await this.getCredentials('rememberTheMilkApi');
    const creds = {
      apiKey: String(stored.apiKey ?? ''),
      sharedSecret: String(stored.sharedSecret ?? ''),
      authToken: String(stored.authToken ?? '') || undefined,
    };

    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter('resource', i) as string;
        const operation = this.getNodeParameter('operation', i) as string;
        const rows = await executeOperation(creds, resource, operation, (name) => this.getNodeParameter(name, i, ''));
        for (const row of rows) output.push({ json: row, pairedItem: { item: i } });
      } catch (error) {
        const message = error instanceof RtmError ? error.message : 'Unexpected error';
        if (this.continueOnFail()) {
          output.push({ json: { error: message } as IDataObject, pairedItem: { item: i } });
          continue;
        }
        throw new NodeOperationError(this.getNode(), message, { itemIndex: i });
      }
    }
    return [output];
  }
}
