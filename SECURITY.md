# Security

Zero Overhead holds hours, invoices, bank transactions and tax figures, so security reports are welcome and taken seriously.

## Reporting a problem

Please report it privately, not in a public issue: open the **Security** tab of this repository and choose **Report a vulnerability**. Include what you found, how to see it, and what someone could do with it.

You'll hear back as soon as possible. Once it's fixed, a new version is released and the fix is noted in [CHANGELOG.md](CHANGELOG.md); you're credited there if you'd like to be.

## How it's built to be safe

- **Login.** Cloudflare Access is the front door. The Worker also checks every request, including the app's own files, for a valid Access token for your team, this app and an allowed email, and refuses everything if that isn't set up. There are no public `workers.dev` or preview addresses.
- **Changes.** The API accepts changes only as JSON from the app's own address, with strict security headers on every response.
- **Bank logins.** Stored encrypted with a key only the Worker holds (`BANK_TOKEN_KEY`). A downloaded backup never includes them.
- **Keys.** Plaid keys and the encryption key are Cloudflare secrets. They're never in the code, your copy on GitHub, or a backup.

## Supported versions

Only the latest version gets fixes. Settings › App version shows yours, and [docs/updating.md](docs/updating.md) shows how to update.
