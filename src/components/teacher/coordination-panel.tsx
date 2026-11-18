"use client";
import { useEffect, useState } from "react";
import type { AcademicData } from "@/types/academic";
import { sessionWindow } from "@/lib/session-window";

interface Summary {
  expected: string[];
  sessions: {
    id: string;
    groupId: string;
    groupName: string;
    subject: string;
    status: string;
    absences: number | null;
  }[];
}

export default function CoordinationPanel({
  groups,
  openSession,
}: {
  groups: AcademicData["groups"];
  openSession: (id: string) => void;
}) {
  const [day, setDay] = useState(() => sessionWindow().date);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const res = await fetch("/api/coordination?day=" + day, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!controller.signal.aborted) setSummary(data);
      } catch {
        if (!controller.signal.aborted) setError("No se pudo cargar la jornada.");
      }
    }
    void load();
    return () => controller.abort();
  }, [day, revision]);
  function refresh() {
    setError("");
    setSummary(null);
    setRevision((value) => value + 1);
  }
  async function toggle(groupId: string, expected: boolean) {
    if (!summary || busy) return;
    const previous = summary;
    setSummary({
      ...summary,
      expected: expected
        ? [...summary.expected, groupId]
        : summary.expected.filter((id) => id !== groupId),
    });
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/coordination", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, groupId, expected }),
      });
      if (!res.ok) throw new Error();
      setRevision((value) => value + 1);
    } catch {
      setSummary(previous);
      setError("No se pudo confirmar el cambio. Actualiza la jornada.");
    } finally {
      setBusy(false);
    }
  }
  const started = new Set(summary?.sessions.map((s) => s.groupId));
  const pending = groups.filter((g) => summary?.expected.includes(g.id) && !started.has(g.id));
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-3xl font-bold tracking-tight">Coordinación diaria</h2>
        <div className="flex items-end gap-3">
          <label className="text-sm">
            Fecha
            <input
              type="date"
              className="block border rounded-lg px-2"
              value={day}
              disabled={busy}
              onChange={(e) => {
                if (e.target.value) {
                  setDay(e.target.value);
                  refresh();
                }
              }}
            />
          </label>
          <button className="rounded-lg border bg-white px-3" onClick={refresh} disabled={busy}>
            Actualizar
          </button>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {!summary && !error && <p role="status">Cargando jornada…</p>}
      {summary && (
        <>
          <details className="bg-white border rounded-xl p-4">
            <summary className="cursor-pointer font-semibold">
              Grupos esperados ({summary.expected.length})
            </summary>
            <div className="flex flex-wrap gap-x-5 mt-3">
              {groups.map((g) => (
                <label className="flex gap-2 items-center" key={g.id}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={summary.expected.includes(g.id)}
                    onChange={(e) => void toggle(g.id, e.target.checked)}
                  />
                  {g.name}
                </label>
              ))}
            </div>
          </details>
          <div className="stat-card">
            <h3 className="font-semibold">Grupos pendientes de iniciar</h3>
            <p>
              {!summary.expected.length
                ? "Selecciona los grupos esperados para esta fecha."
                : pending.length
                  ? pending.map((g) => g.name).join(", ")
                  : "Todos los grupos previstos iniciaron una sesión."}
            </p>
          </div>
          <h3 className="text-lg font-semibold">Lista por clase</h3>
          {!summary.sessions.length && <p>Todavía no hay clases registradas para esta fecha.</p>}
          <ul className="divide-y bg-white rounded-xl">
            {summary.sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <p className="font-semibold">
                    {s.groupName} · {s.subject}
                  </p>
                  <p className="text-sm text-slate-600">
                    {s.absences === null
                      ? "Registro en curso"
                      : `Lista cerrada · ${s.absences} ausencias`}
                  </p>
                </div>
                <button className="text-teal-800 underline" onClick={() => openSession(s.id)}>
                  Ver lista
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
