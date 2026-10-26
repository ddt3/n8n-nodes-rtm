import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

/**
 * Remember The Milk node (skeleton).
 *
 * Offers: the node's identity in n8n (name, icon, one main input/output).
 * Operations (tasks, lists, tags, notes, ...) and the credential type are added in
 * later features; until then the node passes its input items through unchanged.
 */
export class RememberTheMilk implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Remember The Milk',
    name: 'rememberTheMilk',
    icon: 'file:rtm.svg',
    group: ['transform'],
    version: 1,
    description: 'Work with tasks in Remember The Milk',
    defaults: { name: 'Remember The Milk' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'rememberTheMilkApi', required: true }],
    properties: [],
  };

  /**
   * Placeholder execution: returns the input items untouched.
   * Replaced by real operations in Feature D.
   */
  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return [this.getInputData()];
  }
}
