# Contributing

Thanks for helping. Zero Overhead is small on purpose: one person's back office, for freelancers who bill by the hour, running in their own Cloudflare account. Changes that keep it simple, private and correct are the most welcome.

## Good first contributions

- **Tax figures.** New years, and corrections to a state. See [docs/tax-figures.md](docs/tax-figures.md).
- **Statement files** from a bank whose CSV doesn't import cleanly. A sample with the numbers and names changed is the most useful part of the report.
- **Bugs**, with the steps to see them, ideally using the sample data (Settings › Data › Load sample data).

For anything larger, open an issue first to talk it through. Some things are deliberately out of scope for now: fixed-fee projects, multi-user and team features, and hosting outside Cloudflare.

## Working on it

Node 20 or later.

```sh
npm install
cp .dev.vars.example .dev.vars
npm test
npm run dev
```

- `worker/` is the Cloudflare Worker: the API, bank sync, backups and the login check.
- `src/` is the React app.
- `shared/` is used by both: types, time and money helpers, and the tax calculation and figures.
- `migrations/` is the database schema, one numbered SQL file per change. Never edit one that's been released; add a new one.
- `tests/` runs the API against a local database; `*.test.ts` files beside the code test the pieces.

## Pull requests

- Keep each one to one change, with tests for anything that changes behaviour.
- `npm test` and `npm run build` should pass.
- Never include real names, amounts, account numbers or keys, in code, tests, screenshots or commit messages. The sample data and tests use fictional clients (Acme Co, Globex, Northwind Labs) and round amounts.
- If it changes what users see, add a line to [CHANGELOG.md](CHANGELOG.md) under a new version.

## Releases

A release is a version bump in `package.json` and its entry in `CHANGELOG.md`, merged to `main`. Installs check that version nightly and show **Update available**.
