import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Bootstrap, Client, Project, Task } from "../shared/types";
import { toast } from "sonner";
import { api } from "./api";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";

interface DataContext {
  data: Bootstrap;
  setData: (update: (d: Bootstrap) => Bootstrap) => void;
  reload: () => Promise<void>;
  notify: (message: string) => void;
  clientById: Map<number, Client>;
  projectById: Map<number, Project>;
  taskById: Map<number, Task>;
}

const Ctx = createContext<DataContext | null>(null);

export function useData(): DataContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData outside DataProvider");
  return ctx;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setDataState] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setDataState(await api.bootstrap());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<DataContext | null>(() => {
    if (!data) return null;
    return {
      data,
      setData: (update) => setDataState((d) => (d ? update(d) : d)),
      reload,
      notify: (message: string) => toast(message),
      clientById: new Map(data.clients.map((c) => [c.id, c])),
      projectById: new Map(data.projects.map((p) => [p.id, p])),
      taskById: new Map(data.tasks.map((t) => [t.id, t])),
    };
  }, [data, reload]);

  if (error && !data) {
    return (
      <div className="mx-auto max-w-md px-6 py-24">
        <p className="font-semibold">Couldn't load your data.</p>
        <p className="mt-2 text-muted-foreground">{error}</p>
        <Button variant="outline" className="mt-6" onClick={() => void reload()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!value) return <div className="px-6 py-24 text-center text-muted-foreground">Loading…</div>;

  return (
    <Ctx.Provider value={value}>
      {children}
      <Toaster />
    </Ctx.Provider>
  );
}

/** Wrap an action so failures show as a message instead of disappearing. */
export function useAction() {
  const { notify } = useData();
  return useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn();
      } catch (e) {
        notify(e instanceof Error ? e.message : "Something went wrong.");
        return undefined;
      }
    },
    [notify],
  );
}
