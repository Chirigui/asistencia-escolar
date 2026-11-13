"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, Lock, Mail, ArrowRight, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || loading) return;

    setLoading(true);
    setErrorMsg("");

    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password,
      });

      if (error) {
        setErrorMsg(error.message === "Invalid login credentials"
          ? "Credenciales incorrectas. Verifica tu correo y contraseña."
          : error.message
        );
        return;
      }

      if (data.session) {
        router.push("/profesor");
        router.refresh();
      }
    } catch {
      setErrorMsg("Ocurrió un error inesperado al iniciar sesión.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="school-entry min-h-screen bg-slate-50 grid lg:grid-cols-2 items-center gap-12 p-6 lg:px-[8vw] relative">
      <section className="hidden lg:block max-w-xl">
        <p className="eyebrow">ASISTENCIA ESCOLAR</p>
        <h2 className="mt-6 text-6xl font-bold tracking-tight leading-[1.08] text-slate-900">Cada clase<br />cuenta<span className="text-teal-700">.</span></h2>
        <p className="mt-6 text-lg leading-relaxed text-slate-600 max-w-md">Más tiempo para enseñar. Un espacio para organizar tus clases y acompañar la asistencia de tus estudiantes.</p>
        <div className="mt-10 border-t border-slate-200 pt-6 flex gap-8 text-sm text-slate-600"><span>01 · Crea tu clase</span><span>02 · Comparte el QR</span><span>03 · Revisa asistencia</span></div>
      </section>

      <div className="w-full max-w-md mx-auto bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xl shadow-slate-200/60 relative z-10">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-teal-50 border border-blue-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4 text-teal-700">
            <GraduationCap className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Bienvenido a tu aula</h1>
          <p className="text-xs text-slate-600 mt-1">
            Ingreso exclusivo para profesores y directivos
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-xs font-medium text-slate-600 mb-1.5">
              Correo Institucional
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="profesor@colegio.edu.co"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" className="block text-xs font-medium text-slate-600 mb-1.5">
              Contraseña
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              />
            </div>
          </div>

          {errorMsg && (
            <div
              role="alert"
              aria-live="polite"
              className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 text-xs leading-relaxed"
            >
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-teal-700 text-white hover:bg-teal-800 disabled:bg-slate-100 disabled:text-slate-500  font-semibold rounded-xl text-sm transition-all shadow-lg shadow-teal-900/10 flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Ingresando...
              </span>
            ) : (
              <>
                <span>Iniciar Sesión</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-200/80 flex items-center justify-center gap-2 text-[11px] text-slate-500">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>Acceso institucional para docentes y directivos</span>
        </div>
      </div>
    </main>
  );
}
