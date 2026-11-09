import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { toIsoDate } from "../../shared/time";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function toDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** A button showing the date that opens a calendar. Value and onChange use ISO dates (YYYY-MM-DD). */
export function DatePicker({
  id,
  value,
  onChange,
  className,
  placeholder = "Pick a date",
}: {
  id?: string;
  value: string | null | undefined;
  onChange: (iso: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" className={cn("justify-start font-normal", !value && "text-muted-foreground", className)}>
          <CalendarIcon className="text-muted-foreground" />
          {value ? toDate(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value ? toDate(value) : undefined}
          defaultMonth={value ? toDate(value) : undefined}
          onSelect={(d) => {
            if (!d) return;
            onChange(toIsoDate(d));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
