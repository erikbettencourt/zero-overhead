/**
 * Which tax figures a year still needs. Prints a Markdown checklist (empty when nothing is
 * missing). Used by the "Tax figures" workflow, which opens an issue so a person can add the
 * numbers from the official sources and check them.
 *
 *   npx esbuild scripts/tax-figures.ts --bundle --platform=node --format=esm --outfile=.tax-figures.mjs
 *   node .tax-figures.mjs 2027
 */
import { TAX_FIGURES } from "../shared/tax";
import { STATES } from "../shared/states";

const year = Number(process.argv[2]);
if (!Number.isInteger(year) || year < 2000) {
  console.error("Usage: node .tax-figures.mjs <year>");
  process.exit(1);
}

const lines: string[] = [];
const federal = TAX_FIGURES[year];
if (!federal) {
  lines.push(
    `- [ ] **Federal ${year}**: add a \`${year}\` entry to \`TAX_FIGURES\` in \`shared/tax.ts\` (brackets, standard deduction, Social Security wage base, Additional Medicare threshold, QBI threshold and phase-in). Sources: the IRS inflation-adjustments release and Rev. Proc. for ${year} (usually October or November ${year - 1}); SSA for the wage base.`,
  );
} else if (federal.pending?.length) {
  lines.push(`- [ ] **Federal ${year}**: still pending in \`shared/tax.ts\`: ${federal.pending.join(", ")}.`);
}

const states = Object.entries(STATES)
  .filter(([, s]) => !s.noIncomeTax && !s.years[year])
  .map(([code, s]) => `${s.name} (${code})`);
if (states.length) {
  lines.push(
    `- [ ] **States ${year}**: add \`${year}\` figures in \`shared/states.ts\` for ${states.length} state${states.length === 1 ? "" : "s"}: ${states.join(", ")}. Source: Tax Foundation, "State Individual Income Tax Rates and Brackets, ${year}" (usually February), checked against each state's revenue department for anything that looks off.`,
  );
}

if (lines.length) {
  console.log(
    [
      `Zero Overhead estimates taxes from figures kept in the code. Until these are added, ${year} estimates use the latest earlier year's figures and the app says so.`,
      "",
      ...lines,
      "",
      "Add them in a pull request with the sources in the comments, and run `npm test`.",
    ].join("\n"),
  );
}
