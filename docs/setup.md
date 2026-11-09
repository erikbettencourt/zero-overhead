# Set up Zero Overhead

About 30 minutes. At the end you'll have the app at an address on your own domain, like `books.example.com`, that only you can sign in to.

## What you need

- **A Cloudflare account.** The free plan is enough.
- **A domain on Cloudflare.** The app lives at a subdomain of it, and it's the only way in. If your domain is elsewhere, [add it to Cloudflare](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/) first, or buy one through Cloudflare Registrar.
- **A GitHub account.** Your copy of the code lives there, and Cloudflare deploys from it.

Pick the address now, for example `books.example.com`. You'll use it in three places below.

## 1. Set up Cloudflare Access (the login)

Access puts a sign-in page in front of the app. You do this first because the app needs two values from it.

1. In the Cloudflare dashboard, open **Zero Trust**. The first time, it asks you to choose a **team name** (it becomes `yourteam.cloudflareaccess.com`) and a plan. Choose **Free**. It may ask for a card; the free plan isn't charged.
2. Go to **Access › Applications › Add an application › Self-hosted**.
3. **Application name:** Zero Overhead. **Public hostname:** your address, for example `books` on `example.com`.
4. **Login methods:** leave **One-time PIN** on (Access emails you a code), or add Google or another provider under **Settings › Authentication** if you prefer.
5. Add a **policy**: name it "Me", action **Allow**, and under **Include** choose **Emails** and enter your email address.
6. Save. Open the application again and copy its **Application Audience (AUD) Tag**.
7. Note your **team domain**: `https://yourteam.cloudflareaccess.com` (under **Settings › Custom pages** if you're unsure).

## 2. Deploy

1. Click **Deploy to Cloudflare** on the [README](../README.md).
2. Connect GitHub when asked. Cloudflare makes your own copy of the repository in your account, and builds and deploys from it from now on.
3. Keep the suggested names for the D1 database (`zero-overhead`) and the R2 bucket for backups (`zero-overhead-backups`); Cloudflare creates both.
4. When it asks for the variables, enter:
   - `TEAM_DOMAIN`: your team domain from step 1, like `https://yourteam.cloudflareaccess.com`
   - `POLICY_AUD`: the AUD tag from step 1
   - `ALLOWED_EMAILS`: your email address (several can be separated by commas)
5. Keep the build command `npm run build` and the deploy command `npm run deploy`. The deploy command sets up and updates the database before each deploy, so don't replace it with plain `wrangler deploy`.
6. Deploy. The first build takes a minute or two.

The app has no address yet: the `workers.dev` address is turned off on purpose, so your domain is the only way in.

## 3. Give it your address

1. In **Workers & Pages**, open the new Worker, then **Settings › Domains & Routes › Add › Custom domain**.
2. Enter the same address as in step 1, like `books.example.com`, and add it.
3. In **Settings › Builds**, open the **Previews** tab and turn off **Builds for preview branches**. Preview addresses are off, so those builds would only fail.

Open your address. Access asks you to sign in; then you're in.

If you see "Access is not configured for this app", one of the three variables is missing or mistyped. Fix it under the Worker's **Settings › Variables and secrets**.

## 4. Make it yours

- **Settings › Your business:** your name, address and payment instructions, for invoices.
- **Settings › Tax profile:** your state, filing status and any other income, for the tax estimates.
- **Settings › Clients and Projects:** who you work for, with their hourly rates and billing periods.
- **Want to look around first?** Settings › Data › Load sample data adds two fictional clients and a few weeks of hours. Erase it from the same page when you're ready to start for real; your settings stay.

Coming from Harvest or QuickBooks Self-Employed? Settings › Import from Harvest brings over your hours and invoice history, and Spending › Import from QuickBooks brings over how you sorted your transactions.

## 5. Bring in your money

See [Bank and card transactions](bank.md): connect banks through Plaid for nightly downloads, or import statement files.

## 6. Turn on updates

See [Stay up to date](updating.md). One setting in your GitHub copy, and new versions arrive as pull requests.

## Setting it up by hand instead

If you'd rather not use the button:

1. Fork or clone this repository into your GitHub account.
2. Create a D1 database (**Storage & databases › D1 › Create**) and put its ID in `wrangler.jsonc` under `d1_databases`, replacing the zeros.
3. Create an R2 bucket named `zero-overhead-backups`.
4. In **Workers & Pages › Create › Import a repository**, choose your copy. Build command `npm run build`, deploy command `npm run deploy:ci`.
5. Add `TEAM_DOMAIN`, `POLICY_AUD` and `ALLOWED_EMAILS` under the Worker's **Settings › Variables and secrets**, then follow steps 3 to 6 above.
