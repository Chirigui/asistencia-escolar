"use client";
import { useState } from "react";
import type { AcademicData } from "@/types/academic";
export default function AcademicPanel({
  data,
  onSaved,
}: {
  data: AcademicData;
  onSaved: () => void;
}) {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [teacherId, setTeacherId] = useState(""),
    [groupName, setGroupName] = useState("");
  const [document, setDocument] = useState(""),
    [studentGroup, setStudentGroup] = useState(""),
    [status, setStatus] = useState("ACTIVO");
  const [periodName, setPeriodName] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [copy, setCopy] = useState(true);
  const save = async (body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/academic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      setMessage(result.message || "No fue posible guardar.");
      if (result.success) onSaved();
    } catch {
      setMessage("Error de conexión.");
    } finally {
      setBusy(false);
    }
  };
  const field = "w-full border border-slate-200 rounded-xl p-3 bg-white";
  const action = "px-5 py-3 rounded-xl bg-teal-700 text-white disabled:opacity-50";
  return (
    <section className="space-y-6">
      <div>
        <p className="eyebrow">ADMINISTRACIÓN</p>
        <h2 className="text-3xl font-bold mt-2">Organización académica</h2>
        <p className="text-sm text-slate-600 mt-2">
          Período activo: {data.periods.find((p) => p.active)?.name || "Sin configurar"}. Las
          matrículas de sesiones anteriores conservan su padrón.
        </p>
      </div>
      {message && (
        <p role="status" className="p-4 rounded-xl bg-slate-100">
          {message}
        </p>
      )}
      <form
        className="bg-white border rounded-2xl p-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save({ action: "assignment", teacherId, groupName });
        }}
      >
        <h3 className="font-bold">Asignar docente a grupo</h3>
        <label className="block text-sm">
          Docente
          <select
            required
            value={teacherId}
            onChange={(e) => setTeacherId(e.target.value)}
            className={field}
          >
            <option value="">Selecciona un docente</option>
            {data.teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name} · {t.email}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Grupo
          <input
            required
            maxLength={20}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            className={field}
            placeholder="Ej.: 10A"
          />
        </label>
        <button disabled={busy} className={action}>
          Guardar asignación
        </button>
        <ul className="text-sm space-y-2">
          {data.assignments
            .filter((a) => data.periods.some((p) => p.id === a.period_id && p.active))
            .map((a) => (
              <li key={a.id}>
                {data.teachers.find((t) => t.id === a.teacher_id)?.full_name || "Docente"} ·{" "}
                {a.group.name}
              </li>
            ))}
        </ul>
      </form>
      <form
        className="bg-white border rounded-2xl p-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (
            window.confirm(
              "¿Actualizar matrícula? El padrón de las sesiones ya creadas se conserva.",
            )
          )
            void save({ action: "student", document, groupName: studentGroup, status });
        }}
      >
        <h3 className="font-bold">Actualizar matrícula de un estudiante</h3>
        <label className="block text-sm">
          Documento
          <input
            required
            value={document}
            onChange={(e) => setDocument(e.target.value)}
            maxLength={40}
            className={field}
          />
        </label>
        <label className="block text-sm">
          Nuevo grupo
          <input
            required
            value={studentGroup}
            onChange={(e) => setStudentGroup(e.target.value)}
            maxLength={20}
            className={field}
          />
        </label>
        <label className="block text-sm">
          Estado
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={field}>
            <option>ACTIVO</option>
            <option>INACTIVO</option>
            <option>RETIRADO</option>
          </select>
        </label>
        <button disabled={busy} className={action}>
          Actualizar matrícula
        </button>
      </form>
      <form
        className="bg-white border rounded-2xl p-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (
            window.confirm(
              "¿Activar este período académico? Debes cerrar las sesiones abiertas primero.",
            )
          )
            void save({ action: "period", name: periodName, start, end, copyAssignments: copy });
        }}
      >
        <h3 className="font-bold">Abrir un período académico</h3>
        <label className="block text-sm">
          Nombre
          <input
            required
            maxLength={60}
            value={periodName}
            onChange={(e) => setPeriodName(e.target.value)}
            className={field}
          />
        </label>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="text-sm">
            Inicio
            <input
              type="date"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className={field}
            />
          </label>
          <label className="text-sm">
            Fin
            <input
              type="date"
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className={field}
            />
          </label>
        </div>
        <label className="flex gap-3 items-center text-sm">
          <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
          Copiar asignaciones docentes del período actual
        </label>
        <p className="text-xs text-slate-600">
          Se trasladan las matrículas vigentes. El historial anterior se conserva.
        </p>
        <button disabled={busy} className={action}>
          Activar período
        </button>
      </form>
    </section>
  );
}
