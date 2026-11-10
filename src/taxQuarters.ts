import type { TaxQuarter, TaxSummary } from "../shared/types";

/** Within a dollar counts as covered, the same as the server. */
const short = (part: { estimateCents: number; paidCents: number }) => part.paidCents < part.estimateCents - 100;

/**
 * What a quarter's row shows. The next payment shows what to pay, which brings the year up to date:
 * a shortfall earlier is added to it, and an overpayment comes off. Every other quarter shows its
 * even share of the year.
 */
export function quarterAmounts(s: Pick<TaxSummary, "next">, q: TaxQuarter) {
  const isNext = s.next?.quarter === q.quarter;
  return {
    federalCents: isNext ? s.next!.federalCents : q.federal.estimateCents,
    stateCents: isNext ? s.next!.stateCents : q.state.estimateCents,
    /** The quarter's even share, shown under the amount when it differs. */
    federalShareCents: isNext && s.next!.federalCents !== q.federal.estimateCents ? q.federal.estimateCents : null,
    stateShareCents: isNext && s.next!.stateCents !== q.state.estimateCents ? q.state.estimateCents : null,
  };
}

/** "Short", or which one was short when only one was: "Federal short", "MA short". */
export function shortLabel(q: TaxQuarter, state: Pick<TaxSummary["state"], "code" | "chosen">) {
  const federal = short(q.federal);
  const st = short(q.state);
  if (federal && !st) return "Federal short";
  if (st && !federal) return state.chosen && /^[A-Z]{2}$/.test(state.code) ? `${state.code} short` : "State short";
  return "Short";
}
