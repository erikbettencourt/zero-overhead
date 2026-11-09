import { useState } from "react";
import { ArrowUpCircleIcon, CheckCircle2Icon, RefreshCwIcon } from "lucide-react";
import { api } from "../api";
import { niceDate } from "../format";
import { useAction, useData } from "../state";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** Which version this is, and whether a newer one is out. Checked every night. */
export function VersionCard() {
  const run = useAction();
  const { data, setData } = useData();
  const [checking, setChecking] = useState(false);
  const v = data.version;

  async function check() {
    setChecking(true);
    const r = await run(() => api.checkForUpdate());
    setChecking(false);
    if (r) setData((d) => ({ ...d, version: r }));
  }

  return (
    <Card className={cn("p-5", v.updateAvailable && "border-now/40 bg-now-wash/40")}>
      <div className="flex flex-wrap items-start gap-3">
        {v.updateAvailable ? (
          <ArrowUpCircleIcon className="mt-0.5 size-5 shrink-0 text-now" />
        ) : (
          <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-success" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{v.updateAvailable ? `Version ${v.latest} is available` : `Zero Overhead ${v.current}`}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {v.updateAvailable ? (
              <>
                You have {v.current}.{" "}
                <a href={v.changelogUrl} target="_blank" rel="noreferrer" className="font-semibold text-now underline-offset-2 hover:underline">
                  See what's new
                </a>
                . To update, bring the latest changes into your copy of the code on GitHub; Cloudflare deploys them as usual.
              </>
            ) : v.checkedAt ? (
              `Up to date. Last checked ${niceDate(v.checkedAt.slice(0, 10))}.`
            ) : (
              "Checks for a newer version every night."
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void check()} disabled={checking}>
          <RefreshCwIcon className={cn(checking && "animate-spin")} />
          Check now
        </Button>
      </div>
    </Card>
  );
}
