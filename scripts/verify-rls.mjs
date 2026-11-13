#!/usr/bin/env node
/**
 * Verificación de aislamiento RLS contra un proyecto Supabase real.
 *
 * Uso:
 *   NEXT_PUBLIC_SUPABASE_URL=... \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
 *   RLS_TEACHER_A_EMAIL=... RLS_TEACHER_A_PASSWORD=... \
 *   RLS_TEACHER_B_EMAIL=... RLS_TEACHER_B_PASSWORD=... \
 *   RLS_ADMIN_EMAIL=... RLS_ADMIN_PASSWORD=... \
 *   npm run verify:rls
 *
 * Sólo ejecuta lecturas. No crea, modifica ni elimina datos.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const credentials = {
  teacherA: {
    email: process.env.RLS_TEACHER_A_EMAIL,
    password: process.env.RLS_TEACHER_A_PASSWORD,
  },
  teacherB: {
    email: process.env.RLS_TEACHER_B_EMAIL,
    password: process.env.RLS_TEACHER_B_PASSWORD,
  },
  admin: {
    email: process.env.RLS_ADMIN_EMAIL,
    password: process.env.RLS_ADMIN_PASSWORD,
  },
};

const failures = [];

function check(condition, message) {
  if (condition) {
    console.log(`  OK   ${message}`);
  } else {
    console.error(`  FAIL ${message}`);
    failures.push(message);
  }
}

async function signIn(label, { email, password }) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) {
    throw new Error(`${label}: no se pudo iniciar sesión (${error?.message ?? "sin usuario"})`);
  }
  console.log(`Sesión iniciada: ${label} (${email})`);
  return { client, userId: data.user.id };
}

async function main() {
  if (!url || !anonKey) {
    console.log("SKIP: faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    return;
  }

  const missing = Object.entries(credentials).filter(
    ([, value]) => !value.email || !value.password,
  );
  if (missing.length > 0) {
    console.log(
      `SKIP: faltan credenciales de prueba para: ${missing.map(([label]) => label).join(", ")}.`,
    );
    return;
  }

  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("\n[1] Acceso anónimo");
  const anonSessions = await anon.from("sessions").select("id");
  check(
    !anonSessions.error && (anonSessions.data?.length ?? 0) === 0,
    "anon no puede leer sessions",
  );

  const anonIncidents = await anon.from("incidents").select("id");
  check(
    !anonIncidents.error && (anonIncidents.data?.length ?? 0) === 0,
    "anon no puede leer incidents",
  );

  const anonRpc = await anon.rpc("register_student_attendance", {
    p_session_code: "S000000",
    p_document_normalized: "0000000000",
  });
  check(Boolean(anonRpc.error), "anon no puede ejecutar el RPC de asistencia");

  const teacherA = await signIn("teacherA", credentials.teacherA);
  const teacherB = await signIn("teacherB", credentials.teacherB);
  const admin = await signIn("admin", credentials.admin);

  console.log("\n[2] Aislamiento entre docentes");
  const aSessions = await teacherA.client.from("sessions").select("id, teacher_id, status");
  const bSessions = await teacherB.client.from("sessions").select("id, teacher_id, status");

  check(!aSessions.error, "teacherA puede consultar sus sesiones");
  check(!bSessions.error, "teacherB puede consultar sus sesiones");
  check(
    (aSessions.data ?? []).every((row) => row.teacher_id === teacherA.userId),
    "teacherA sólo ve sesiones propias",
  );
  check(
    (bSessions.data ?? []).every((row) => row.teacher_id === teacherB.userId),
    "teacherB sólo ve sesiones propias",
  );

  const aIds = new Set((aSessions.data ?? []).map((row) => row.id));
  const overlap = (bSessions.data ?? []).filter((row) => aIds.has(row.id));
  check(overlap.length === 0, "las sesiones de A y B no se cruzan");

  if (bSessions.data?.length) {
    const foreignSession = await teacherA.client
      .from("sessions")
      .select("id")
      .eq("id", bSessions.data[0].id)
      .maybeSingle();
    check(
      !foreignSession.error && foreignSession.data === null,
      "teacherA no puede leer una sesión de teacherB",
    );
  }

  console.log("\n[3] Perfiles y roles");
  const aProfiles = await teacherA.client.from("profiles").select("id, role");
  check(
    !aProfiles.error &&
      (aProfiles.data ?? []).length === 1 &&
      aProfiles.data[0].id === teacherA.userId,
    "teacherA sólo ve su propio perfil",
  );

  const adminProfiles = await admin.client.from("profiles").select("id, role");
  check(
    !adminProfiles.error && (adminProfiles.data ?? []).length > 1,
    "admin puede ver todos los perfiles",
  );

  const adminSessions = await admin.client.from("sessions").select("id");
  check(
    !adminSessions.error &&
      (adminSessions.data ?? []).length >=
        (aSessions.data ?? []).length + (bSessions.data ?? []).length,
    "admin ve las sesiones de ambos docentes",
  );

  console.log("\n[4] RPC y escrituras restringidas");
  const teacherRpc = await teacherA.client.rpc("register_student_attendance", {
    p_session_code: "S000000",
    p_document_normalized: "0000000000",
  });
  check(Boolean(teacherRpc.error), "un docente no puede ejecutar el RPC directamente");

  console.log("\n[5] Incidencias");
  const aIncidents = await teacherA.client.from("incidents").select("id, session_id");
  check(
    !aIncidents.error &&
      (aIncidents.data ?? []).every((row) => row.session_id && aIds.has(row.session_id)),
    "teacherA sólo ve incidencias de sus sesiones",
  );

  console.log(
    failures.length === 0
      ? "\nVerificación RLS completada sin fallos."
      : `\nVerificación RLS con ${failures.length} fallo(s).`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
