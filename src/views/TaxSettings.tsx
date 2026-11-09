import { useEffect, useState, type FormEvent } from "react";
import type { FilingStatus, TaxProfile } from "../../shared/types";
import { parseMoney } from "../../shared/time";
import { CUSTOM_STATE, STATE_LIST } from "../../shared/states";
import { api } from "../api";
import { useAction, useData } from "../state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type MoneyKey = Exclude<
  keyof TaxProfile,
  "filingStatus" | "state" | "customStateRateBps" | "localTaxRateBps"
>;

const GROUPS: {
  title: string;
  intro: string;
  fields: [MoneyKey, string, string?][];
}[] = [
  {
    title: "Other income",
    intro: "Leave these at 0 if freelancing is your only income.",
    fields: [
      ["w2WagesCents", "W-2 wages for the year", "From a job, before taxes."],
      ["w2FederalWithheldCents", "Federal tax withheld from that job"],
      ["w2StateWithheldCents", "State tax withheld from that job"],
      [
        "otherIncomeCents",
        "Other taxable income",
        "Interest, or a spouse's income on a joint return.",
      ],
    ],
  },
  {
    title: "Last year",
    intro:
      "From last year's returns. With these, Taxes shows the safe harbor amount that avoids underpayment penalties.",
    fields: [
      [
        "priorYearFederalTaxCents",
        "Total federal tax",
        "Form 1040, total tax.",
      ],
      ["priorYearStateTaxCents", "Total state tax", "From your state return."],
      [
        "priorYearAgiCents",
        "Adjusted gross income",
        "Over $150,000 means the federal safe harbor is 110%.",
      ],
    ],
  },
  {
    title: "This year",
    intro: "",
    fields: [
      [
        "expectedProfitCents",
        "Expected profit for the year",
        "Leave at 0 to project from the year so far. Set it if you know a big invoice is coming or work is ending.",
      ],
    ],
  },
];

/** Basis points as a percent string, and back: 500 is "5". */
const showRate = (bps: number) => (bps ? String(bps / 100) : "");
function parseRate(s: string): number | undefined {
  const t = s.trim().replace(/%$/, "");
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 20
    ? Math.round(n * 100)
    : undefined;
}

const show = (cents: number) =>
  cents
    ? (cents / 100).toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })
    : "0";

export function TaxProfileSettings() {
  const run = useAction();
  const { notify } = useData();
  const [profile, setProfile] = useState<TaxProfile | null>(null);
  const [form, setForm] = useState<Record<MoneyKey, string>>(
    {} as Record<MoneyKey, string>,
  );
  const [status, setStatus] = useState<FilingStatus>("single");
  const [state, setState] = useState("");
  const [customRate, setCustomRate] = useState("");
  const [localRate, setLocalRate] = useState("");
  const [saving, setSaving] = useState(false);

  function fill(p: TaxProfile) {
    setProfile(p);
    setStatus(p.filingStatus);
    setState(p.state);
    setCustomRate(showRate(p.customStateRateBps));
    setLocalRate(showRate(p.localTaxRateBps));
    setForm(
      Object.fromEntries(
        [
          ...GROUPS.flatMap((g) => g.fields).map(([k]) => k),
          "customStateDeductionCents" as const,
        ].map((k) => [k, show(p[k])]),
      ) as Record<MoneyKey, string>,
    );
  }
  useEffect(() => {
    void run(() => api.taxProfile()).then((p) => p && fill(p));
  }, [run]);

  const parsed = Object.fromEntries(
    Object.entries(form).map(([k, v]) => [k, parseMoney(v) ?? 0]),
  ) as Record<MoneyKey, number | undefined>;
  const customBps = parseRate(customRate);
  const localBps = parseRate(localRate);
  const invalid = [
    ...Object.entries(parsed)
      .filter(([, v]) => v === undefined)
      .map(([k]) => k),
    ...(customBps === undefined ? ["customRate"] : []),
    ...(localBps === undefined || (localBps ?? 0) > 1000 ? ["localRate"] : []),
  ];
  const picked = STATE_LIST.find((s) => s.code === state);
  const showLocal =
    state === CUSTOM_STATE ||
    picked?.localTaxes ||
    (profile?.localTaxRateBps ?? 0) > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (invalid.length) return;
    setSaving(true);
    const saved = await run(() =>
      api.saveTaxProfile({
        filingStatus: status,
        state,
        customStateRateBps: customBps ?? 0,
        localTaxRateBps: showLocal ? (localBps ?? 0) : 0,
        ...(parsed as Record<MoneyKey, number>),
      }),
    );
    setSaving(false);
    if (saved) {
      fill(saved);
      notify("Tax profile saved.");
    }
  }

  if (!profile) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <section>
      <h2 className="text-lg font-bold">Tax profile</h2>
      <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
        What the quarterly estimate needs to know beyond your freelance income.
        Check it each January, or whenever your situation changes.
      </p>
      <Card className="mt-5 overflow-hidden">
        <form onSubmit={submit}>
          <CardContent className="grid gap-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid content-start gap-2">
                <Label htmlFor="tax-status">Filing status</Label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as FilingStatus)}
                >
                  <SelectTrigger id="tax-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single</SelectItem>
                    <SelectItem value="joint">
                      Married filing jointly
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid content-start gap-2">
                <Label htmlFor="tax-state">State you live in</Label>
                <Select value={state} onValueChange={setState}>
                  <SelectTrigger id="tax-state" aria-invalid={state === ""}>
                    <SelectValue placeholder="Choose your state" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATE_LIST.map((s) => (
                      <SelectItem key={s.code} value={s.code}>
                        {s.name}
                        {s.noIncomeTax && (
                          <span className="text-muted-foreground">
                            {" "}
                            (no income tax)
                          </span>
                        )}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_STATE}>
                      Somewhere else: enter a rate
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {state === ""
                    ? "Until you choose, the estimate leaves out state tax."
                    : picked?.noIncomeTax
                      ? "No state income tax on your freelance income."
                      : "Rates and deductions come from published tables and are updated each year."}
                </p>
              </div>
              {state === CUSTOM_STATE && (
                <>
                  <RateField
                    id="tax-custom-rate"
                    label="State tax rate"
                    value={customRate}
                    onChange={setCustomRate}
                    hint="Your state's rate, or your effective rate from last year's return."
                    bad={customBps === undefined}
                  />
                  <div className="grid content-start gap-2">
                    <Label htmlFor="tax-customStateDeductionCents">
                      State deduction
                    </Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                        $
                      </span>
                      <Input
                        id="tax-customStateDeductionCents"
                        inputMode="decimal"
                        className="num pl-6"
                        value={form.customStateDeductionCents ?? ""}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            customStateDeductionCents: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Standard deduction plus exemptions, taken off before the
                      rate.
                    </p>
                  </div>
                </>
              )}
              {showLocal && (
                <RateField
                  id="tax-local-rate"
                  label="City or county income tax"
                  value={localRate}
                  onChange={setLocalRate}
                  hint="Leave blank if your city or county doesn't tax income. For example, New York City or a Maryland county."
                  bad={localBps === undefined || (localBps ?? 0) > 1000}
                />
              )}
            </div>
            {GROUPS.map((g) => (
              <fieldset key={g.title} className="grid gap-4 border-t pt-5">
                <div>
                  <legend className="font-semibold">{g.title}</legend>
                  {g.intro && (
                    <p className="text-sm text-muted-foreground">{g.intro}</p>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {g.fields.map(([k, label, hint]) => (
                    <div key={k} className="grid content-start gap-2">
                      <Label htmlFor={`tax-${k}`}>{label}</Label>
                      <div className="relative">
                        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                          $
                        </span>
                        <Input
                          id={`tax-${k}`}
                          inputMode="decimal"
                          className="num pl-6"
                          value={form[k] ?? ""}
                          aria-invalid={parsed[k] === undefined}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, [k]: e.target.value }))
                          }
                        />
                      </div>
                      {parsed[k] === undefined ? (
                        <p className="text-xs text-destructive">
                          Enter an amount like 12,500.
                        </p>
                      ) : (
                        hint && (
                          <p className="text-xs text-muted-foreground">
                            {hint}
                          </p>
                        )
                      )}
                    </div>
                  ))}
                </div>
              </fieldset>
            ))}
          </CardContent>
          <CardFooter className="justify-end border-t">
            <Button type="submit" disabled={saving || invalid.length > 0}>
              {saving ? "Saving…" : "Save tax profile"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </section>
  );
}

function RateField({
  id,
  label,
  value,
  onChange,
  hint,
  bad,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint: string;
  bad: boolean;
}) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          className="num pr-7"
          value={value}
          aria-invalid={bad}
          placeholder="0"
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">
          %
        </span>
      </div>
      {bad ? (
        <p className="text-xs text-destructive">Enter a percent like 4.5.</p>
      ) : (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
