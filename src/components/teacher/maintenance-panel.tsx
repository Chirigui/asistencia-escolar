"use client";
import { useEffect, useState } from "react";

export default function MaintenancePanel({ onCleared }: { onCleared: () => void }) {
  const [enabled, setEnabled] = useState(false),
    [ready, setReady] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({}),
    [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/maintenance", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (!data.success) throw new Error(data.message);
        setEnabled(data.enabled);
        setCounts(data.counts);
        setReady(true);
      })
      .catch(() => {
        if (active)
          setMessage(
            "No se pudo consultar el estado de mantenimiento. Recarga para intentarlo de nuevo.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  const run = async (action: "cache" | "clear") => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirmation }),
      });
      const data = await response.json();
      if (!response.ok || !data.success)
        throw new Error(data.message || "No se pudo completar la operación.");
      // No touch to authentication cookies or unrelated localStorage entries.
      try {
        if ("caches" in window)
          await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
      } catch {
        /* HTTP cache eviction is separately requested via Clear-Site-Data. */
      }
      setConfirmation("");
      setMessage(data.message);
      if (action === "clear") {
        setCounts({ sessions: 0, attendances: 0, incidents: 0 });
        onCleared();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error de conexión.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="bg-white border border-rose-200 rounded-2xl p-6 space-y-4"
      aria-labelledby="maintenance-title"
    >
      <h3 id="maintenance-title" className="font-bold">
        Pruebas y limpieza
      </h3>
      <p className="text-sm text-slate-600">
        La caché de este navegador y los datos de Supabase son cosas distintas. Limpiar caché no
        borra asistencias, no cierra tu sesión ni limpia otros dispositivos.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run("cache")}
        className="px-4 py-3 border rounded-xl disabled:opacity-50"
      >
        Limpiar caché de este navegador
      </button>
      <p className="text-sm text-slate-700">
        Datos que se eliminarán para todos los docentes: {counts.sessions ?? "…"} sesiones,{" "}
        {counts.attendances ?? "…"} asistencias y {counts.incidents ?? "…"} incidencias.
      </p>
      <p className="text-sm text-slate-600">
        Se conservan todos los estudiantes, matrículas, grupos, asignaciones, períodos y cuentas. El
        historial de seguridad se conserva, incluidos los motivos de registros manuales. No hay
        deshacer: guarda un respaldo antes. Estos recuentos pueden cambiar si otra persona registra
        datos.
      </p>
      {!enabled && ready && (
        <p className="text-sm text-slate-600">
          El borrado está desactivado en el servidor. Sólo se habilita durante las pruebas.
        </p>
      )}
      <label className="block text-sm">
        Para borrar, escribe <strong>BORRAR SESIONES DE PRUEBA</strong>
        <input
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          disabled={!ready || !enabled || busy}
          autoComplete="off"
          className="block w-full border rounded-xl p-3 mt-2"
        />
      </label>
      <button
        type="button"
        disabled={busy || !ready || !enabled || confirmation !== "BORRAR SESIONES DE PRUEBA"}
        onClick={() => void run("clear")}
        className="px-4 py-3 bg-rose-700 text-white rounded-xl disabled:opacity-50"
      >
        {busy ? "Procesando…" : "Borrar sesiones, asistencias e incidencias"}
      </button>
      {message && (
        <p role="status" className="text-sm p-3 bg-slate-100 rounded-xl">
          {message}
        </p>
      )}
    </section>
  );
}
