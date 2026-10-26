import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RememberTheMilkApi } from '../credentials/RememberTheMilkApi.credentials';
import { RememberTheMilk } from '../nodes/RememberTheMilk/RememberTheMilk.node';

// Tests for the credential type (Feature B / Step 2).
describe('RememberTheMilkApi credential type', () => {
  const credential = new RememberTheMilkApi();
  const field = (name: string) => credential.properties.find((p) => p.name === name);

  it('has the name and display name n8n uses to find and show it', () => {
    expect(credential.name).toBe('rememberTheMilkApi');
    expect(credential.displayName).toBe('Remember The Milk API');
    expect(credential.documentationUrl).toMatch(/^https:\/\//);
  });

  it('masks every secret field in the UI', () => {
    for (const name of ['apiKey', 'sharedSecret', 'authToken']) {
      expect(field(name), `${name} exists`).toBeDefined();
      expect(field(name)?.typeOptions?.password, `${name} is masked`).toBe(true);
    }
  });

  it('bakes no default value into any secret field', () => {
    for (const name of ['apiKey', 'sharedSecret', 'authToken']) {
      expect(field(name)?.default).toBe('');
    }
  });

  it('requires the API key and shared secret but not the token (it comes from authorising)', () => {
    expect(field('apiKey')?.required).toBe(true);
    expect(field('sharedSecret')?.required).toBe(true);
    expect(field('authToken')?.required).not.toBe(true);
  });

  it('offers read, write and delete permission and defaults to delete', () => {
    const permission = field('permission');
    expect(permission?.type).toBe('options');
    const values = (permission?.options as { value: string }[]).map((o) => o.value);
    expect(values).toEqual(['read', 'write', 'delete']);
    expect(permission?.default).toBe('delete');
  });
});

describe('credential wiring', () => {
  it('is required by the node under the same name', () => {
    const node = new RememberTheMilk();
    expect(node.description.credentials).toEqual([{ name: 'rememberTheMilkApi', required: true }]);
  });

  it('is registered in package.json and its source file exists', () => {
    const root = join(__dirname, '..');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      n8n: { credentials: string[] };
    };
    expect(pkg.n8n.credentials).toContain('dist/credentials/RememberTheMilkApi.credentials.js');
    // The compiled path maps back to this source file.
    expect(existsSync(join(root, 'credentials/RememberTheMilkApi.credentials.ts'))).toBe(true);
  });
});
