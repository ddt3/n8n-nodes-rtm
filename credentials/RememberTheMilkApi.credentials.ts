import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Credential type for the Remember The Milk API.
 *
 * Offers: the form in which n8n asks for, encrypts and stores the three secret values
 * (API key, shared secret, auth token) plus the permission level used when authorising.
 *
 * Security rules:
 *   - every secret field is masked in the UI (`password: true`);
 *   - no field has a default value, so nothing secret is ever baked into the package;
 *   - the values live only in n8n's encrypted credential store and are read inside the node.
 */
export class RememberTheMilkApi implements ICredentialType {
  name = 'rememberTheMilkApi';
  displayName = 'Remember The Milk API';
  documentationUrl = 'https://www.rememberthemilk.com/services/api/';

  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description: 'The API key you received from Remember The Milk',
    },
    {
      displayName: 'Shared Secret',
      name: 'sharedSecret',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description: 'The shared secret that belongs to the API key. It is used to sign requests and is never sent.',
    },
    {
      displayName: 'Auth Token',
      name: 'authToken',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description: 'Long-lived token from the one-time authorisation. Leave empty until you have authorised.',
    },
    {
      displayName: 'Permission',
      name: 'permission',
      type: 'options',
      options: [
        { name: 'Read', value: 'read', description: 'Read tasks and lists' },
        { name: 'Write', value: 'write', description: 'Read, add and change tasks' },
        { name: 'Delete', value: 'delete', description: 'Read, write and delete tasks' },
      ],
      default: 'delete',
      description: 'Permission level requested when you authorise. Deleting tasks needs "Delete".',
    },
  ];
}
