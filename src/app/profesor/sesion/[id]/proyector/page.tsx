"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type ProjectorSession = {
  session: { code: string; subject: string; group_name: string; date: string };
  sessionUrl: string;
  qrDataUrl: string;
  stats: { total: number; presentsCount: number; absentsCount: number };
};

export default function ProjectorPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<ProjectorSession | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const loadSession = async () => {
      const response = await fetch(`/api/sessions/${params.id}`);
      const result = await response.json();
      if (!active) return;
      if (!result.success) { setError(result.message || "No se pudo cargar la sesión."); return; }
      setData(result);
    };
    loadSession().catch(() => setError("No se pudo conectar con el servidor."));
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/sessions/${params.id}/stats`, { cache: "no-store" });
        const result = await response.json();
        if (active && result.success) setData((current) => current ? { ...current, stats: result.stats } : current);
      } catch { /* Conserva los últimos conteos recibidos. */ }
    }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [params.id]);

  if (error) return <main className="min-h-screen bg-slate-950 text-white grid place-items-center p-8">{error}</main>;
  if (!data) return <main className="min-h-screen bg-slate-950 text-slate-300 grid place-items-center">Cargando proyector…</main>;

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 flex flex-col items-center justify-center gap-5 text-center">
      <div>
        <p className="text-3xl font-semibold">{data.session.subject} · Grupo {data.session.group_name}</p>
        <p className="mt-2 text-5xl font-black tracking-[0.2em]">{data.session.code}</p>
      </div>
      <img src={data.qrDataUrl} alt="Código QR para registrar asistencia" className="h-[70vh] max-h-[70vh] w-auto aspect-square rounded-3xl bg-white p-4" />
      <div className="grid grid-cols-3 gap-8 text-3xl font-bold">
        <p>Total <span className="block text-5xl">{data.stats.total}</span></p>
        <p>Presentes <span className="block text-5xl text-emerald-400">{data.stats.presentsCount}</span></p>
        <p>Ausentes <span className="block text-5xl text-rose-400">{data.stats.absentsCount}</span></p>
      </div>
      <p className="text-lg text-slate-400">{data.sessionUrl}</p>
    </main>
  );
}
