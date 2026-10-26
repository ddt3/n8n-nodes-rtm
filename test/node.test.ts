import { describe, expect, it } from 'vitest';
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { RememberTheMilk } from '../nodes/RememberTheMilk/RememberTheMilk.node';

// Tests for the node skeleton (Feature A / Step 1).
describe('RememberTheMilk node skeleton', () => {
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

  it('passes input items through unchanged until operations exist', async () => {
    // Block: a minimal fake execution context that only supplies the input items.
    const items: INodeExecutionData[] = [{ json: { example: 1 } }];
    const context = { getInputData: () => items } as unknown as IExecuteFunctions;

    const result = await node.execute.call(context);

    expect(result).toEqual([items]);
  });
});
