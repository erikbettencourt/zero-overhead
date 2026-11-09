import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import type { ExpenseCategory } from "../../shared/types";
import { categoryLabel } from "../format";
import { useData } from "../state";
import { SelectItem, SelectSeparator } from "@/components/ui/select";

/**
 * The category options for a select: the ones you've used, plus whichever is chosen, with
 * "Show all categories" for the rest of Schedule C. Before anything is used, all of them show.
 */
export function CategoryItems({ current, label = categoryLabel }: { current?: number | null; label?: (c: ExpenseCategory) => string }) {
  const { data } = useData();
  const [showAll, setShowAll] = useState(false);
  const short = data.categories.filter((c) => c.used || c.id === current);
  const shown = showAll || short.length === 0 ? data.categories : short;
  const hidden = data.categories.length - shown.length;
  return (
    <>
      {shown.map((c) => (
        <SelectItem key={c.id} value={String(c.id)}>
          {label(c)}
        </SelectItem>
      ))}
      {hidden > 0 && (
        <>
          <SelectSeparator />
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent"
            // Keep the list open and show the rest in place.
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setShowAll(true)}
          >
            <ChevronDownIcon className="size-4" />
            Show all categories ({hidden} more)
          </button>
        </>
      )}
    </>
  );
}

/** Once you pick a category, it joins the short list. */
export function useMarkCategoryUsed() {
  const { setData } = useData();
  return (id: number | null | undefined) => {
    if (!id) return;
    setData((d) => (d.categories.some((c) => c.id === id && !c.used) ? { ...d, categories: d.categories.map((c) => (c.id === id ? { ...c, used: true } : c)) } : d));
  };
}
