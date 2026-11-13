import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; CREATE SCHEMA extensions;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
 GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon,authenticated,service_role;`);
  let base = await readFile("supabase/schema.sql", "utf8");
  base = base
    .replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/, "")
    .replaceAll("uuid_generate_v4()", "gen_random_uuid()");
  await db.exec(base);
  await db.exec(
    "GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,service_role; GRANT SELECT ON public.sessions TO anon;",
  );
  for (const name of (await readdir("supabase/migrations"))
    .filter((n) => n > "20261112_security_hardening.sql")
    .sort()) {
    await db.exec(await readFile("supabase/migrations/" + name, "utf8"));
    console.log("Migration OK:", name);
  }
  const results = await db.exec(await readFile("supabase/tests/regression.sql", "utf8"));
  await db.exec("INSERT INTO public.school_groups(name) VALUES('RESTORE-ONLY')");
  const snapshot = await db.dumpDataDir();
  const restored = new PGlite({ loadDataDir: snapshot });
  try {
    const check = await restored.query(
      "select count(*)::int as n from public.school_groups where normalized_name='RESTOREONLY'",
    );
    if (check.rows[0].n !== 1) throw new Error("Restore validation failed");
    console.log("Local snapshot restore OK");
  } finally {
    await restored.close();
  }
  console.log(
    "Database regression OK:",
    results.filter((r) => r.rows.length).map((r) => r.rows),
  );
} catch (error) {
  console.error({ message: error.message, code: error.code, where: error.where });
  process.exitCode = 1;
} finally {
  await db.close();
}
