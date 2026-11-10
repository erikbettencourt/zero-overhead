# What's new

Each version's changes, newest first. The app checks this repo's version every night and shows **Update available** in the header when there's a newer one. To update, bring the latest changes into your copy of the code on GitHub; Cloudflare deploys them as usual.

## 0.2.4

- **The next tax payment shows what to pay.** On Taxes, the Due next row now matches the amount at the top: the quarter's share, plus any shortfall from earlier quarters, less any overpayment. The share itself shows underneath.
- **Short says which.** A quarter where only one payment fell short says "Federal short" or, for example, "CO short".
- The note under the table explains overpaying as well as underpaying.

## 0.2.3

- **Spending is now Transactions.** The page holds every bank and card transaction, money in and out, so it's named for that. Its address stays `#/spending`, so bookmarks still work. Settings › Spending rules is now Transaction rules.
- **A tidier header.** Sync now sits beside when it last synced (with the time), and one **Import** menu holds Bank statement and From QuickBooks, all on the right.
- **Filter by Income.** The category filter has Income, so Business › Income shows the business money that came in.
- **Better rule suggestions for bank transfers.** The wand now suggests just the company for ACH payments ("Acme Co", not "Acme Co DES:Bill"), so a rule keeps matching when the payer changes their note. If you made a rule from one before, check it in Settings › Transaction rules.
- A rule's match count now opens Transactions through your local date, not the server's.

## 0.2.2

- **Restoring a backup keeps your transfers.** Before, a restore turned every transaction and rule marked Transfer into Personal.
- **Restores check the backup fits.** Backups now record their database version, and a restore stops before changing anything if the backup is from a newer version than the app. Backup files with unexpected column names are refused.
- **Taxes use your date, not the server's.** In the evening the server's clock (UTC) is already on tomorrow, which could move a payment due date or the year a little early.
- **For contributors:** every pull request is now type-checked, built and tested (CI), packages are updated monthly by pull request, and [SECURITY.md](SECURITY.md) says how to report a security problem privately.

## 0.2.1

- **Docs.** A step-by-step [setup guide](docs/setup.md) with the Deploy to Cloudflare button, [bank and card transactions](docs/bank.md) with or without Plaid, [staying up to date](docs/updating.md), [tax figures](docs/tax-figures.md), and [CONTRIBUTING.md](CONTRIBUTING.md).
- **Settings › App version.** Your version and update check now have their own tab, apart from your data.
- **Update from upstream workflow** for your copy: checks daily for a new version and opens a pull request. Turn it on with one setting; see [Stay up to date](docs/updating.md). If your copy was made before this version, copy `.github/workflows/update-from-upstream.yml` over by hand once.

## 0.2.0

- **Update available notice.** Settings › Data shows your version and whether a newer one is out (checked nightly, or with Check now), and the header says so when there is.
- **Tax figures reminder.** Each November and February a GitHub workflow opens an issue listing the federal or state tax figures the coming year still needs, so they're added from the official sources and checked by a person.

## 0.1.0

First public version.

- Time tracking by client, project and task, with Harvest import.
- Reports and invoices, with the hours report on page 2.
- Spending from your bank (Plaid) or imported statements (CSV), sorted business or personal, with rules, business-only accounts and transfers.
- Invoices paid by matching their deposits, including one deposit for several invoices.
- Quarterly federal and state tax estimates for every state, and a year-end summary for your accountant (PDF and CSV).
- Nightly backups to R2, and a QuickBooks Self-Employed import.
