import { useEffect, useState } from "react";
import { getAirtableConnectivity } from "@/lib/production-adapter/connectivity.functions";

type Connectivity = {
  status: "CONFIGURED" | "NOT_CONFIGURED";
  missing: string[];
  detail: string;
};

/**
 * Shows the real connector's configuration state. It never claims a live
 * connection and never displays credential values.
 */
export function AirtableConnectivityPanel() {
  const [state, setState] = useState<Connectivity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getAirtableConnectivity()
      .then((result) => {
        if (active) setState(result as Connectivity);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, []);

  const connected = state?.status === "CONFIGURED";

  return (
    <div className="space-y-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-sm px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.14em] ${
            connected
              ? "bg-primary/15 text-primary"
              : "bg-destructive/15 text-destructive"
          }`}
        >
          {error ? "STATUS UNAVAILABLE" : (state?.status ?? "CHECKING…")}
        </span>
        <span className="text-muted-foreground">
          {error ?? state?.detail ?? "Resolving connector configuration…"}
        </span>
      </div>

      {state && state.missing.length > 0 ? (
        <div className="rounded-sm border border-border/70 bg-muted/30 p-3">
          <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            Missing configuration
          </div>
          <ul className="space-y-0.5 font-mono text-[11px]">
            {state.missing.map((key) => (
              <li key={key}>{key}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="space-y-1 text-muted-foreground">
        <li>· Connector issues HTTP GET only; a non-GET call throws before leaving the process.</li>
        <li>· Only the 19 real HOUSEHOLD EVENTS field names are requested.</li>
        <li>· With no configuration the runtime reads nothing — it never falls back to fixtures.</li>
      </ul>
    </div>
  );
}
