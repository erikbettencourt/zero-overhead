# Stay up to date

New versions come out in this repository. Your copy on GitHub doesn't change on its own; you bring updates in when you're ready, and Cloudflare deploys them like any other change.

The app tells you when there's one: **Settings › App version** shows your version, and the top of every page says **Update available** when a newer one is out. [CHANGELOG.md](../CHANGELOG.md) says what's in each.

## The update workflow (recommended)

Your copy includes a GitHub workflow, **Update from upstream**, that checks for a new version every day and opens a pull request in your copy when there is one. You read it, merge it, and Cloudflare deploys it.

To turn it on, in your copy on GitHub:

1. Open **Settings › Actions › General**.
2. Under **Actions permissions**, choose **Allow all actions and reusable workflows**.
3. At the bottom, under **Workflow permissions**, tick **Allow GitHub Actions to create and approve pull requests**, and save.

To check it now, open the **Actions** tab, choose **Update from upstream**, and click **Run workflow**.

When a pull request arrives, merge it with **Create a merge commit**, so the next update knows where this one left off.

### What it brings over

Everything except your copy's own settings:

- `wrangler.jsonc` keeps your database ID. If an update also changes that file, the pull request says so and you merge it by hand.
- The `.github` folder is left alone. GitHub doesn't let a workflow change workflow files, so a new version of this workflow is noted in the changelog for you to copy over yourself.

Database changes are applied automatically when Cloudflare deploys, before the new code starts.

## By hand

If you'd rather not use the workflow:

```sh
git remote add upstream https://github.com/erikbettencourt/zero-overhead
git fetch upstream
git merge upstream/main     # add --allow-unrelated-histories the first time, if Git asks
git push
```
