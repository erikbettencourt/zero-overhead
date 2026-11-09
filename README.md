# Zero Overhead

The freelance back office you own. Hours, invoices, spending and quarterly taxes, running in your own Cloudflare account for about $15 a year.

> Status: early build. Not ready for general use yet.

## Who it's for

Solo freelancers and consultants in the US who **bill by the hour**. You track time, and invoices bill the hours. Fixed-fee projects, deposits and payment schedules aren't supported yet.

## What it does

- **Time tracking:** a weekly timesheet by client, project and task, a running timer, and a one-step import of your Harvest history.
- **Reports and invoices:** a monthly report per client, and invoices that lock the hours they bill, print as a PDF with the hours report on page 2, and keep their details as issued.
- **Money and taxes:** pull transactions from your bank and cards, separate business from personal, match deposits to the invoices they paid, and estimate quarterly federal and state taxes.

Your data lives in your own Cloudflare D1 database. Nothing personal is ever stored in this repository.

## How it's secured

1. **Cloudflare Access** sits in front of the app. Nobody reaches it without signing in through the identity provider you choose.
2. **The Worker checks every request again.** It verifies the signed Access token (issuer, audience and allowed email) before serving anything, including the app's own files. If the app isn't configured, it refuses all requests.
3. **No side doors.** The `workers.dev` and preview addresses are turned off, so your own domain is the only way in.
4. **Bank logins are encrypted at rest** with `BANK_TOKEN_KEY`, a secret only the Worker holds. They're read-only Plaid tokens, and they're never included in a downloaded backup.

## Backups and restore

Three layers, from most recent to oldest:

1. **Time Travel** (built into D1, always on). Roll the database back to any minute in the last 7 days (30 on the Workers Paid plan). Best for "I just deleted something".
   ```sh
   npx wrangler d1 time-travel info zero-overhead            # what's available
   npx wrangler d1 time-travel restore zero-overhead --timestamp=2027-03-01T09:00:00Z
   ```
   A restore prints a bookmark for the state it replaced, so a restore can itself be undone.
2. **Nightly backups in R2.** Every night at 09:17 UTC (early morning in the US; change the cron in `wrangler.jsonc` to move it) the Worker saves the whole database to the `zero-overhead-backups` bucket: the last 90 nights in `daily/`, and the first backup of each month for 7 years in `monthly/`. Settings > Data shows the last backup and lets you download any of them, or back up now.
3. **Your own copies.** Settings > Data > Download a copy saves everything to a file. Keep one somewhere outside Cloudflare now and then.

**To restore from a backup file** (replaces everything in the database with the file's contents):

```sh
# 1. Get the file: download it from Settings > Data, or straight from R2
npx wrangler r2 object get zero-overhead-backups/daily/2027-03-01.json --file backup.json --remote

# 2. Turn it into SQL, then run it against the database
node scripts/restore.mjs backup.json > restore.sql
npx wrangler d1 execute zero-overhead --remote --file restore.sql
```

To rehearse first, run step 2 with `--local` instead of `--remote`, then `npm run dev` and look around. Nightly backups include the encrypted bank logins, so banks keep syncing after a restore as long as `BANK_TOKEN_KEY` is unchanged. A downloaded copy leaves them out, so after restoring from one, connect each bank again.

## Setup

A full step-by-step guide is coming. In short:

1. Create a Cloudflare Access application for your hostname, with a policy allowing only your email.
2. Create a D1 database and put its ID in `wrangler.jsonc` under `d1_databases`.
3. Connect this repo to Cloudflare Workers with build command `npm run build` and deploy command `npm run deploy:ci` (it applies database migrations, then deploys). Keep that deploy command: plain `wrangler deploy` skips the migrations.
4. In the Worker's settings, add the variables from `.dev.vars.example`, and attach your hostname as a custom domain.
5. For bank sync, add `PLAID_CLIENT_ID`, `PLAID_SECRET` and `BANK_TOKEN_KEY` as secrets. Make the key with `openssl rand -base64 32`, and keep a copy in your password manager: without it, a restored backup can't use its bank logins.
6. For nightly backups, create an R2 bucket named `zero-overhead-backups` before deploying.

## Development

```sh
npm install
cp .dev.vars.example .dev.vars
npm test
npm run build
```

## Disclaimer

Tax figures are estimates to help you plan, not tax advice.

## License

MIT
