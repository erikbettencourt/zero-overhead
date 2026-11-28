# What's new

Each version's changes, newest first. The app checks this repo's version every night and shows **Update available** in the header when there's a newer one. To update, bring the latest changes into your copy of the code on GitHub; Cloudflare deploys them as usual.

## 0.2.6

- **New entries open in a form.** Add entry and N open a New entry form over the day, so a half-typed row never sits in the list. Enter saves from anywhere in it, Shift+Enter starts a new line in Notes, and Esc or Cancel leaves nothing behind. Entries you already have still edit right in the line.
- **One Add entry button.** It sits at the bottom of the day, solid, with its N shortcut. The Track time button at the top right is gone from both views.
- **S skips a suggestion.** Select one with the arrow keys and press S. Delete and Backspace no longer do anything in the list, so nothing gets deleted by accident; delete from the line's menu instead.
- **Shortcuts you can put away.** The keyboard shortcuts show under the day on your first visit. Close them with the X, and press ? or the small keyboard icon to bring them back. This device remembers.
- In the Time field of the entry form, up and down add or take off 30 minutes, as they do inline.

## 0.2.5

- **Faster time entry on the Day view.** Click an entry, or select it and press Tab, to change its task, description and hours right in the line. Enter saves and Esc puts it back. To change the project or day, use the line's menu, which opens the full form.
- **Keyboard all the way.** Left and right change days, up and down move between entries, N adds a row at the bottom, and Delete asks first, inline. In Hours, up and down add or take off 30 minutes; anything you type is kept exactly.
- **Suggestions.** When you log the same project, task and note on at least 3 of the last 4 same weekdays, that day offers it under "Usually on Fridays", with your usual time and why it showed up. Add makes it a real entry, the X skips it for that day. Two a day at most, and they never count toward a total until added.
- **A clearer header.** The title is Timesheet in both views, with hours then money underneath: 6h today, 33h 14m this week, $4,985 billable. Track time is a solid button on both.
- **Hours read 2h 30m** across the Day and Week views, and days with nothing tracked stay blank instead of 0:00.

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
