# Tax figures

The tax estimates come from figures kept in the code, one set per tax year:

- **Federal** figures are in [`shared/tax.ts`](../shared/tax.ts), in `TAX_FIGURES`: brackets, the standard deduction, the Social Security wage base, the Additional Medicare threshold, and the QBI deduction threshold and phase-in.
- **State** figures are in [`shared/states.ts`](../shared/states.ts), in `STATES`: each state's brackets for single and joint filers, standard deduction, personal exemption, credit, and any cap on deducting self-employment tax. One calculation in `tax.ts` works for every state.

Everything is in cents, and rates are fractions (5% is `0.05`). The `$()` and `pct()` helpers convert dollars and percents for you.

When a year's figures aren't in yet, the app uses the latest earlier year's and says so on the Taxes page.

## When new figures come out

- **Federal:** the IRS publishes next year's inflation adjustments in a news release and Revenue Procedure, usually in October or November. The Social Security wage base comes from the SSA in October.
- **States:** the Tax Foundation's "State Individual Income Tax Rates and Brackets" table comes out each February. Check anything surprising against the state's own revenue department.

Each November 20 and February 15, the **Tax figures** workflow opens an issue listing what the coming year still needs. You can also check any year yourself:

```sh
npx esbuild scripts/tax-figures.ts --bundle --platform=node --format=esm --outfile=.tax-figures.mjs
node .tax-figures.mjs 2027
```

## Adding a year

1. Copy the latest year's entry, change the year, and update each number from the sources above. Put the sources in the comment at the top of the file.
2. If a figure isn't published yet, keep last year's number and name it in `pending` (federal only); the app lists pending figures on the Taxes page.
3. Run `npm test`. The tests check every state has the shape the calculation expects and pin a few worked examples; update an example's expected number only after checking it by hand.
4. Open a pull request.

## Adding or correcting a state

Each state is one entry, built with a few helpers:

- `flat(rate, extra)`: one rate for everyone, like `flat(4.25, { standardDeduction: pair(…) })`.
- `same(brackets, extra)`: the same brackets for single and joint filers, as `[from dollars, rate %]` pairs.
- `graduated(single, joint, extra)`: different brackets for single and joint filers.
- `none(name)`: no tax on wages or self-employment income.

Set `localTaxes: true` for states where cities or counties also tax income; the Tax profile then shows a field for a local rate.

States that define taxable income their own way are approximated from federal adjusted gross income, and every state is assumed to use the federal due dates. If your state works differently in a way that changes the estimate much, open an issue.
