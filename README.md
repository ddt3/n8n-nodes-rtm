# n8n-nodes-rtm

An [n8n](https://n8n.io) community node for the [Remember The Milk](https://www.rememberthemilk.com) API.

> **Status: early development.** Only the package skeleton exists so far; task operations are
> added step by step. This is an unofficial project and is not affiliated with Remember The Milk.

## Why a node

Every Remember The Milk API call has to be signed with your shared secret. Doing that with HTTP
Request nodes means the secret ends up in expressions, workflow JSON or execution data. This node
keeps your **API key, shared secret and auth token in n8n's encrypted credential store** and does
the signing inside the node, so none of them pass through workflow data.

## Planned operations

Lists, task search (RTM filter syntax), add task, due date and priority, tags, move to list,
complete and delete, notes and the task URL field. A helper for the one-time authorisation
(frob and token exchange) is planned as well.

## Install

Not published to npm yet. Until then, build it locally (see Development) and load it as a custom
node in your n8n instance. See the
[n8n docs on community nodes](https://docs.n8n.io/integrations/community-nodes/) for the install options.

## Credentials

You need your own Remember The Milk API key and shared secret
([request them from RTM](https://www.rememberthemilk.com/services/api/)). Enter them in the n8n
credential form only. **Never put them in this repository, in a workflow or in an issue.**

## Development

```sh
npm install        # also installs the pre-commit secret scan (core.hooksPath = .githooks)
npm run check      # lint (0 warnings), typecheck, build, secret scan, tests
```

Tests use a mocked API and obviously fake values. Fake secrets in tests are built at run time so
the source contains no secret-looking literal.

### Secret safeguards

This repository is public, so:

- `.gitignore` excludes `.env*`, key files and `secrets/`.
- `scripts/secret-scan.mjs` scans for secret-looking strings. It runs as a pre-commit hook and in CI,
  and it reports only file, line and rule, never the matched value.
- If a secret is ever committed, treat it as compromised and rotate it; removing it from history is
  not enough.

## License

[MIT](LICENSE)
