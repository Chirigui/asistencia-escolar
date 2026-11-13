"use client";
import { useCallback, useEffect, useState } from "react";
interface AuditEvent {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  action: string;
  before_value: { status?: string; notes?: string };
  after_value: { status?: string; notes?: string };
  actor: { full_name: string } | null;
}
export default function AuditTrail({ sessionId }: { sessionId: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const load = useCallback(
    async (next?: string | null) => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/sessions/${sessionId}/audit${next ? "?cursor=" + encodeURIComponent(next) : ""}`,
          { cache: "no-store" },
        );
        const data = await response.json();
        if (!response.ok) throw new Error();
        setEvents((previous) => (next ? [...previous, ...data.events] : data.events));
        setCursor(data.nextCursor);
      } catch {
        setError("No fue posible consultar el historial.");
      } finally {
        setLoading(false);
      }
    },
    [sessionId],
  );
  useEffect(() => {
    const initial = async () => {
      await load();
    };
    void initial();
  }, [load]);
  return (
    <section aria-label="Historial de auditoría" className="border-t pt-4 mt-4">
      <h4 className="font-bold text-sm">Historial de cambios</h4>
      {error && <p role="alert">{error}</p>}
      <ol className="max-h-52 overflow-y-auto space-y-3 text-xs mt-3">
        {events.map((event) => (
          <li key={event.id} className="border-l-2 border-teal-200 pl-3">
            <p className="font-semibold">
              {event.action} ·{" "}
              {event.actor?.full_name ||
                (event.actor_id ? "Personal institucional" : "Sistema / QR")}
            </p>
            <time dateTime={event.occurred_at}>
              {new Date(event.occurred_at).toLocaleString("es-CO", { timeZone: "America/Bogota" })}
            </time>
            <p>
              {event.before_value?.status || "—"} → {event.after_value?.status || "—"}
            </p>
            {event.after_value?.notes && <p>Motivo: {event.after_value.notes}</p>}
          </li>
        ))}
      </ol>
      {loading && <p role="status">Cargando historial…</p>}
      {!loading && !events.length && !error && (
        <p className="text-xs">No hay cambios registrados.</p>
      )}
      {cursor && (
        <button disabled={loading} onClick={() => load(cursor)} className="text-sm underline">
          Cargar más cambios
        </button>
      )}
    </section>
  );
}
