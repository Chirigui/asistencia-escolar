import { Pool } from "pg";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const address = process.env.DATABASE_TEST_URL;
if (!address)
  throw new Error("DATABASE_TEST_URL is required for the isolated PostgreSQL concurrency suite");
const parsed = new URL(address);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
  parsed.pathname != "/asistencia_ci"
)
  throw new Error("This suite only accepts the local asistencia_ci database");
const pool = new Pool({
  connectionString: address,
  max: 12,
  connectionTimeoutMillis: 3000,
  statement_timeout: 12000,
});
const clients = [];
const connect = async () => {
  const client = await pool.connect();
  clients.push(client);
  return client;
};
const teacher = "40000000-0000-4000-8000-000000000001",
  student = "50000000-0000-4000-8000-000000000001",
  session = "60000000-0000-4000-8000-000000000001",
  burstSession = "60000000-0000-4000-8000-000000000002";
const beginStaff = async (client) => {
  await client.query("BEGIN");
  await client.query(
    "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)",
    [teacher],
  );
  await client.query("SET LOCAL ROLE authenticated");
};
try {
  const setup = await connect();
  await setup.query(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE SCHEMA extensions;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}');CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon,authenticated,service_role;`,
  );
  await setup.query(await readFile("supabase/schema.sql", "utf8"));
  await setup.query(
    "GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,service_role;GRANT SELECT ON public.sessions TO anon;",
  );
  await setup.query(
    await readFile("supabase/migrations/20261113000100_professional_foundation.sql", "utf8"),
  );
  await setup.query(await readFile("supabase/tests/regression.sql", "utf8"));
  await setup.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [
    teacher,
    "concurrency@example.invalid",
  ]);
  await setup.query(
    "INSERT INTO public.students(id,document,document_normalized,full_name,grade,group_name) VALUES($1,'TEST91001','TEST91001','Concurrent Student','TEST','TESTC')",
    [student],
  );
  await setup.query(
    "INSERT INTO public.teaching_assignments(period_id,teacher_id,group_id) SELECT p.id,$1,g.id FROM public.academic_periods p CROSS JOIN public.school_groups g WHERE p.active AND g.normalized_name='TESTC'",
    [teacher],
  );
  for (const [id, code] of [
    [session, "CLOSE-TEST"],
    [burstSession, "BURST-TEST"],
  ])
    await setup.query(
      "INSERT INTO public.sessions(id,code,teacher_id,subject,group_name,date,start_time,end_time) VALUES($1,$2,$3,'Concurrency','TESTC',(now() AT TIME ZONE 'America/Bogota')::date,'00:00','23:59')",
      [id, code, teacher],
    );
  const a = await connect(),
    b = await connect();
  await beginStaff(a);
  await beginStaff(b);
  const first = await a.query(
    "SELECT public.record_manual_attendance($1,'TEST91001','PRESENTE','Concurrency test') result",
    [session],
  );
  assert.equal(first.rows[0].result.success, true);
  let closeFinished = false,
    closeError;
  const closing = b
    .query("UPDATE public.sessions SET status='CERRADA' WHERE id=$1", [session])
    .then(
      () => {
        closeFinished = true;
      },
      (error) => {
        closeError = error;
      },
    );
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(closeError, undefined);
  assert.equal(
    closeFinished,
    false,
    "Closing must wait for the in-flight registration transaction",
  );
  await a.query("COMMIT");
  await closing;
  if (closeError) throw closeError;
  await b.query("COMMIT");
  console.log("Concurrent registration/close serialization OK");
  await beginStaff(a);
  await assert.rejects(
    a.query("SELECT public.record_manual_attendance($1,'TEST91001','PRESENTE','After close')", [
      session,
    ]),
    (error) => error.code === "23514",
  );
  await a.query("ROLLBACK");
  const results = await Promise.all(
    Array.from({ length: 8 }, async () => {
      const client = await connect();
      await beginStaff(client);
      const response = await client.query(
        "SELECT public.record_manual_attendance($1,'TEST91001','PRESENTE','Burst duplicate test') result",
        [burstSession],
      );
      await client.query("COMMIT");
      return response.rows[0].result;
    }),
  );
  assert.equal(results.filter((r) => r.success).length, 1);
  assert.equal(results.filter((r) => r.code === "ALREADY_REGISTERED").length, 7);
  const counts = await setup.query(
    "SELECT (SELECT count(*)::int FROM public.attendances WHERE session_id=$1) attendances,(SELECT count(*)::int FROM public.audit_events WHERE session_id=$1 AND action='attendances.insert') audits",
    [burstSession],
  );
  assert.deepEqual(counts.rows[0], { attendances: 1, audits: 1 });
  console.log("8 concurrent duplicate requests: exactly one attendance and one audit OK");
  console.log("PostgreSQL regression and concurrency suite passed");
} catch (error) {
  console.error({ message: error.message, code: error.code });
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map((c) => c.query("ROLLBACK").catch(() => {})));
  for (const c of clients) c.release();
  await pool.end();
}
