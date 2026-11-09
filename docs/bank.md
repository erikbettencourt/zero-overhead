# Bank and card transactions

Spending, income from deposits, and the tax estimates all come from your bank and card transactions. There are two ways to bring them in, and you can use both: Plaid for the banks it supports, statements for the rest.

## Option 1: Plaid (downloads every night)

[Plaid](https://plaid.com) connects to most US banks and card issuers. Each bank login you connect brings in all its accounts, with up to two years of history, and new transactions download every night.

1. Sign up at [plaid.com](https://dashboard.plaid.com/signup) and apply for production access. Personal use of your own accounts is a common case. Plaid's free plan covers 10 bank connections.
2. In the Plaid dashboard, open **Developers › Keys** and copy your **client ID** and **Production secret**.
3. Make an encryption key for the bank logins: run `openssl rand -base64 32` in a terminal. **Save this key in your password manager.** Without it, a restored backup can't use its bank logins.
4. In Cloudflare, open your Worker's **Settings › Variables and secrets** and add three secrets (type **Secret**): `PLAID_CLIENT_ID`, `PLAID_SECRET` and `BANK_TOKEN_KEY`. Then deploy again (**Deployments › Retry**, or push any change).
5. In the app, open **Settings › Bank accounts › Connect a bank**.

To try it with Plaid's test bank first, add a plain variable `PLAID_ENV` set to `sandbox` and use your Sandbox secret; log in as `user_good` with password `pass_good`. Remove `PLAID_ENV` for your real banks.

The keys stay in Cloudflare. They're never in the code, in your GitHub copy, or in a downloaded backup.

## Option 2: Statement files (no Plaid)

Most banks and card issuers let you download transactions as a CSV file (sometimes called "Excel" or "spreadsheet" format).

1. In the app, open **Spending › Import statement** (or **Settings › Bank accounts › Import a statement**).
2. Choose **New account…**, give it a name, and choose bank account or credit card.
3. Choose the CSV file. The app works out which columns hold the date, description and amount, and which way round the amounts are (card exports often show charges as positive numbers). Check the preview: charges should show as money out. Change any column if it guessed wrong; the account remembers them for next time.
4. Import.

Do it again each month, or whenever you like. A file that overlaps one you've already imported adds only the new transactions.

## Sorting

Each transaction is **business** or **personal**. Business spending needs a category, which is its Schedule C line; health insurance premiums have their own category because they're deducted separately.

- **Rules** sort the regulars: on any transaction, the wand button makes a rule from it ("anything containing ADOBE is business, Office expense"). Rules apply to past transactions they fit and to every new one.
- **Business accounts.** For an account that holds only business money, turn on **Business account** in Settings › Bank accounts. Its charges come in as business, and money moved between your own accounts (owner draws, money you put in, card payments) can be marked **Transfer**, which is neither income nor spending.
- **Deposits that paid an invoice** get a suggestion ("Looks like payment for 1042") in Spending. Accept it, and the invoice is marked paid on the day the money arrived.
