"use client";
import SchoolMark from "@/components/ui/school-mark";
import { school } from "@/lib/school";

import { useState } from "react";
import { Lock, Mail, ArrowRight, ShieldCheck } from "lucide-react";

export default function LoginPage() {
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
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setErrorMsg(data.message || "No fue posible iniciar sesión.");
        return;
      }
      window.location.replace("/profesor");
    } catch {
      setErrorMsg("Ocurrió un error inesperado al iniciar sesión.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="school-entry min-h-screen bg-slate-50 grid lg:grid-cols-2 items-center gap-12 p-6 lg:px-[8vw] relative">
      <section className="school-cover hidden lg:flex flex-col justify-end">
        <p className="text-sm tracking-wide">{school.name}</p>
        <h2 className="mt-5 text-6xl tracking-tight leading-tight font-serif">
          Asistencia escolar
        </h2>
        <p className="mt-5 max-w-sm text-base leading-relaxed">
          Abre tu clase, proyecta el código QR y consulta la lista de asistencia.
        </p>
      </section>

      <div className="w-full max-w-md mx-auto bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xl shadow-slate-200/60 relative z-10">
        <div className="mb-8">
          <p className="eyebrow mb-3">{school.name}</p>
          <SchoolMark />
          <h1 className="mt-4 text-2xl font-bold text-slate-900 tracking-tight">
            Bienvenido a tu aula
          </h1>
          <p className="text-xs text-slate-600 mt-1">
            Ingreso exclusivo para profesores y directivos
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label
              htmlFor="login-email"
              className="block text-xs font-medium text-slate-600 mb-1.5"
            >
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
            <label
              htmlFor="login-password"
              className="block text-xs font-medium text-slate-600 mb-1.5"
            >
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
              aria-label="Error de acceso"
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
