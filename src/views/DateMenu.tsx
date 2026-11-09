import { useState } from "react";
import {
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { toIsoDate } from "../../shared/time";
import {
  modeOf,
  rangeFor,
  rangeLabel,
  shiftRange,
  type Range,
} from "../periods";
import { cn } from "@/lib/utils";
import { DatePicker } from "@/components/date-picker";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const today = () => toIsoDate(new Date());

function presets(allowAll: boolean): [string, Range | null][] {
  const t = today();
  const list: [string, Range | null][] = [
    ["This week", rangeFor("week", t)],
    ["Last week", shiftRange(rangeFor("week", t), -1)],
    ["This month", rangeFor("month", t)],
    ["Last month", shiftRange(rangeFor("month", t), -1)],
    ["This quarter", rangeFor("quarter", t)],
    ["Last quarter", shiftRange(rangeFor("quarter", t), -1)],
    ["This year", rangeFor("year", t)],
    ["Last year", shiftRange(rangeFor("year", t), -1)],
  ];
  return allowAll ? [["All dates", null], ...list] : list;
}

const same = (a: Range | null, b: Range | null) =>
  a === null ? b === null : b !== null && a.from === b.from && a.to === b.to;

/**
 * One dropdown for dates: quick choices, plus your own range. With onAll, "All dates" is a
 * choice and a null range means all of them. With arrows, ‹ and › step a week, month,
 * quarter or year at a time (or a custom range by its own length).
 */
export function DateMenu({
  range,
  onChange,
  onAll,
  arrows,
}: {
  range: Range | null;
  onChange: (r: Range) => void;
  onAll?: () => void;
  arrows?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const list = presets(!!onAll);
  const preset = list.find(([, r]) => same(r, range));
  const label = preset ? preset[0] : range ? rangeLabel(range) : "All dates";
  const [from, setFrom] = useState(
    range?.from ?? rangeFor("year", today()).from,
  );
  const [to, setTo] = useState(range?.to ?? today());

  function pick(r: Range | null) {
    if (r) onChange(r);
    else onAll?.();
    setOpen(false);
  }

  const step = arrows && range !== null;
  return (
    <div className="flex">
      {step && (
        <Button
          variant="outline"
          size="icon"
          className="rounded-r-none"
          aria-label={`Earlier ${modeOf(range) === "custom" ? "dates" : modeOf(range)}`}
          onClick={() => onChange(shiftRange(range, -1))}
        >
          <ChevronLeftIcon />
        </Button>
      )}
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o && range) {
            setFrom(range.from);
            setTo(range.to);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full justify-between font-normal sm:w-40",
              step && "-mx-px rounded-none sm:w-52",
            )}
            aria-label="Dates"
          >
            <span className="flex items-center gap-2">
              <CalendarIcon className="text-muted-foreground" />
              {label}
            </span>
            <ChevronDownIcon className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1">
          {list.map(([name, r]) => (
            <button
              key={name}
              type="button"
              onClick={() => pick(r)}
              className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            >
              <span>
                {name}
                {r && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {rangeLabel(r)}
                  </span>
                )}
              </span>
              {same(r, range) && <CheckIcon className="size-4" />}
            </button>
          ))}
          <div className="mt-1 border-t px-2 pt-2 pb-1.5">
            <p className="text-xs font-semibold text-muted-foreground">
              Custom
            </p>
            <div className="mt-1.5 grid gap-1.5">
              <DatePicker
                id="dates-from"
                value={from}
                onChange={(d) => setFrom(d)}
              />
              <DatePicker id="dates-to" value={to} onChange={(d) => setTo(d)} />
              <Button
                size="sm"
                disabled={from > to}
                onClick={() => pick({ from, to })}
              >
                Show {rangeLabel({ from, to })}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {step && (
        <Button
          variant="outline"
          size="icon"
          className="rounded-l-none"
          aria-label={`Later ${modeOf(range) === "custom" ? "dates" : modeOf(range)}`}
          onClick={() => onChange(shiftRange(range, 1))}
        >
          <ChevronRightIcon />
        </Button>
      )}
    </div>
  );
}
