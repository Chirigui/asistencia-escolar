import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { readRegister, markNames, termLabel } from "@/lib/semester";
import RegisterRefresh from "@/components/teacher/register-refresh";

export default async function Register({
  params,
}: {
  params: Promise<{ group: string; term: string }>;
}) {
  const auth = await requireAdmin();
  if (!auth.ok) redirect("/profesor");
  const { group, term } = await params;
  const list = await readRegister(auth.ctx, group, term);
  if (!list) notFound();
  return (
    <main className="max-w-screen-2xl mx-auto p-4 sm:p-8 space-y-5">
      <Link
        href={`/profesor/listas?year=${term.slice(0, 4)}&half=${term.slice(-1)}`}
        className="text-teal-800 underline"
      >
        Todos los grupos
      </Link>
      <header>
        <p className="eyebrow">{termLabel(term)}</p>
        <h1 className="text-3xl font-bold">Asistencia de {list.groupName}</h1>
      </header>
      <p>
        {list.classes.length} reuniones cerradas · {list.students.length} estudiantes. El porcentaje
        incluye las llegadas tarde y usa las reuniones que le correspondían a cada estudiante.
      </p>
      {list.historical && (
        <p>
          Algunas listas antiguas se reconstruyeron con la matrícula disponible al migrar el
          sistema.
        </p>
      )}
      <div className="flex gap-3">
        <a
          className="rounded bg-teal-700 px-4 py-3 text-white"
          href={`/api/listas/${group}/${term}/excel`}
        >
          Descargar Excel
        </a>
        <RegisterRefresh />
      </div>
      <div className="overflow-x-auto max-h-[70vh] rounded-xl border bg-white">
        <table className="text-sm w-full text-left [&_td]:p-3 [&_th]:p-3">
          <thead className="sticky top-0 bg-teal-900 text-white">
            <tr>
              {[
                "Estudiante",
                "Reuniones",
                "Asistió",
                "Faltó",
                "Justificadas",
                "Asistencia",
                ...list.classes.map(
                  (c) => c.date + " · " + c.time + " · " + c.subject + " · " + c.code,
                ),
              ].map((h, i) => (
                <th scope="col" className="min-w-24" key={i}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.students.map((s) => (
              <tr key={s.id} className="even:bg-slate-50">
                <th scope="row">{s.name}</th>
                <td>{s.total}</td>
                <td>{s.attended}</td>
                <td>{s.absent}</td>
                <td>{s.excused}</td>
                <td>{s.total ? Math.round((1000 * s.attended) / s.total) / 10 + " %" : "—"}</td>
                {list.classes.map((c) => (
                  <td key={c.id}>{markNames[s.marks[c.id]] ?? "Sin matrícula"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!list.classes.length && (
        <p>La primera reunión aparecerá cuando se cierre una sesión real de este grupo.</p>
      )}
    </main>
  );
}
