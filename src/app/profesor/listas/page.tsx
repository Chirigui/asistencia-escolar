import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { sessionWindow } from "@/lib/session-window";
import { validTerm } from "@/lib/semester";

export default async function Lists({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; half?: string }>;
}) {
  const auth = await requireAdmin();
  if (!auth.ok) redirect("/profesor");
  const q = await searchParams;
  const date = sessionWindow().date;
  const requested = `${q.year}-${q.half}`;
  const term = validTerm(requested)
    ? requested
    : date.slice(0, 4) + "-" + (Number(date.slice(5, 7)) <= 6 ? 1 : 2);
  const { data, error } = await auth.ctx.supabase
    .from("school_groups")
    .select("id,name")
    .order("name");
  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      <Link href="/profesor" className="text-teal-800 underline">
        Volver al panel
      </Link>
      <h1 className="text-3xl font-bold">Listas semestrales por grupo</h1>
      <form className="flex flex-wrap items-end gap-4">
        <label>
          Año
          <input
            className="block border rounded p-2"
            name="year"
            type="number"
            min="1900"
            max="2200"
            required
            defaultValue={term.slice(0, 4)}
          />
        </label>
        <label>
          Semestre
          <select className="block border rounded p-2" name="half" defaultValue={term.slice(-1)}>
            <option value="1">Enero a junio</option>
            <option value="2">Julio a diciembre</option>
          </select>
        </label>
        <button className="rounded bg-teal-700 px-4 text-white">Consultar</button>
      </form>
      {error ? (
        <p role="alert">No se pudieron cargar los grupos.</p>
      ) : data?.length ? (
        <ul className="grid sm:grid-cols-3 gap-3">
          {data.map((g) => (
            <li key={g.id}>
              <Link
                href={`/profesor/listas/${g.id}/${term}`}
                className="block rounded-xl border p-4 bg-white font-semibold text-teal-800"
              >
                {g.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>No hay grupos registrados.</p>
      )}
    </main>
  );
}
