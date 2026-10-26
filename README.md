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

Development needs Node 22.12 or newer (CI runs Node 22 and 24).

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

## One-time authorisation

RTM needs an auth token next to the API key and shared secret. Get it once, on your own machine:

```sh
npm ci && npm run build
export RTM_API_KEY=...        # set in your shell, not in a file in this repo
export RTM_SHARED_SECRET=...
node scripts/rtm-authorize.mjs start      # prints an approval URL and a frob
# open the URL, approve, then:
node scripts/rtm-authorize.mjs finish <frob>   # prints the auth token
```

Put the token in the n8n credential field "Auth Token" only. The key and secret are read from the
environment, never from arguments, so they stay out of shell history.
