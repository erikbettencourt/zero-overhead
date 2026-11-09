# What's new

Each version's changes, newest first. The app checks this repo's version every night and shows **Update available** in the header when there's a newer one. To update, bring the latest changes into your copy of the code on GitHub; Cloudflare deploys them as usual.

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
