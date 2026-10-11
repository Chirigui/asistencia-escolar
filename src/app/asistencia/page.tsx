"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  QrCode,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  GraduationCap,
  Clock,
  Sparkles,
  ArrowRight,
} from "lucide-react";

interface SessionInfo {
  id: string;
  code: string;
  subject: string;
  group_name: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
}

interface RegisterResult {
  success: boolean;
  message: string;
  code?: string;
  data?: {
    studentName: string;
    grade: string;
    group: string;
    subject: string;
    registeredAt: string;
  };
  student?: {
    name: string;
  };
}

function StudentAttendanceForm() {
  const searchParams = useSearchParams();
  const sessionCodeFromUrl = searchParams.get("sesion") || searchParams.get("s") || "";

  const [sessionCode, setSessionCode] = useState(sessionCodeFromUrl.toUpperCase());
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [sessionError, setSessionError] = useState("");

  const [documentInput, setDocumentInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [currentTime, setCurrentTime] = useState("");

  // Reloj en vivo
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString("es-CO", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Cargar info de sesión
  useEffect(() => {
    if (!sessionCode) {
      setLoadingSession(false);
      setSessionError("Por favor escanea el código QR de tu clase para registrarte.");
      return;
    }

    const fetchSession = async () => {
      try {
        setLoadingSession(true);
        const res = await fetch(`/api/sessions/info?code=${encodeURIComponent(sessionCode)}`);
        const data = await res.json();

        if (data.success && data.session) {
          setSession(data.session);
          setSessionError("");
        } else {
          setSession(null);
          setSessionError(data.message || "La sesión no existe o no está disponible.");
        }
      } catch (err) {
        setSessionError("No fue posible contactar el servidor escolar.");
      } finally {
        setLoadingSession(false);
      }
    };

    fetchSession();
  }, [sessionCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!documentInput.trim() || submitting || !sessionCode) return;

    setSubmitting(true);
    setResult(null);

    try {
      const res = await fetch("/api/attendance/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionCode,
          document: documentInput.trim(),
        }),
      });

      const data = await res.json();
      setResult(data);

      if (data.success) {
        setDocumentInput(""); // Limpiar para el siguiente o confirmación
      }
    } catch (err) {
      setResult({
        success: false,
        message: "Error de conexión al enviar el registro. Verifica tu internet.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden backdrop-blur-xl">
      {/* Luz decorativa superior */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 bg-blue-500/20 blur-3xl pointer-events-none rounded-full" />

      {/* Cabecera */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/30">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Colegio San José
            </h2>
            <p className="text-sm font-semibold text-white">Asistencia Escolar QR</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-800/80 border border-slate-700/60 rounded-full text-xs font-mono text-slate-300">
          <Clock className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
          <span>{currentTime}</span>
        </div>
      </div>

      {/* Tarjeta de la clase activa */}
      {loadingSession ? (
        <div className="p-5 rounded-2xl bg-slate-800/50 border border-slate-800 animate-pulse mb-6 text-center text-slate-400 text-sm">
          Verificando sesión de clase...
        </div>
      ) : session ? (
        <div className="mb-6 p-4 rounded-2xl bg-slate-800/60 border border-slate-700/50">
          <div className="flex items-center justify-between mb-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              CLASE ABIERTA
            </span>
            <span className="text-xs font-mono font-medium text-slate-400">
              {session.code}
            </span>
          </div>
          <h3 className="text-lg font-bold text-white leading-tight">
            {session.subject}
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Grupo <span className="font-semibold text-slate-200">{session.group_name}</span> · Horario: {session.start_time.slice(0, 5)} - {session.end_time.slice(0, 5)}
          </p>
        </div>
      ) : (
        <div className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
          <div className="text-xs leading-relaxed">
            <p className="font-semibold mb-0.5">Atención:</p>
            <p>{sessionError}</p>
          </div>
        </div>
      )}

      {/* Formulario de documento */}
      {session && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="document"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Número de Identificación / Tarjeta de Identidad
            </label>
            <input
              id="document"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoFocus
              required
              value={documentInput}
              onChange={(e) => setDocumentInput(e.target.value)}
              placeholder="Ej: 1000000001"
              disabled={submitting}
              className="w-full px-4 py-3.5 bg-slate-950 border border-slate-700 rounded-xl text-lg font-medium text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-center tracking-wider"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !documentInput.trim()}
            className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-semibold rounded-xl shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 group text-sm"
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Registrando...
              </span>
            ) : (
              <>
                <span>Registrar Asistencia</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </form>
      )}

      {/* Resultado de confirmación */}
      {result && (
        <div
          className={`mt-6 p-4 rounded-2xl border text-sm animate-in fade-in zoom-in-95 duration-200 ${
            result.success
              ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-200"
              : result.code === "ALREADY_REGISTERED"
              ? "bg-amber-950/40 border-amber-500/40 text-amber-200"
              : "bg-rose-950/40 border-rose-500/40 text-rose-200"
          }`}
        >
          <div className="flex items-start gap-3">
            {result.success ? (
              <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
            ) : result.code === "ALREADY_REGISTERED" ? (
              <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
            )}

            <div className="flex-1">
              <h4 className="font-bold text-sm">
                {result.success
                  ? "¡Asistencia Confirmada!"
                  : result.code === "ALREADY_REGISTERED"
                  ? "Registro Previo Detectado"
                  : "No se pudo registrar"}
              </h4>
              <p className="text-xs mt-1 text-slate-300 leading-relaxed">
                {result.message}
              </p>

              {result.data && (
                <div className="mt-2.5 pt-2 border-t border-emerald-500/20 text-xs space-y-0.5 font-medium">
                  <p className="text-white">Estudiante: {result.data.studentName}</p>
                  <p className="text-slate-400">
                    Grupo: {result.data.group} · Grado: {result.data.grade}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 pt-4 border-t border-slate-800 text-center">
        <p className="text-[11px] text-slate-500">
          Sistema Seguro de Asistencia Escolar · Desarrollado para uso institucional
        </p>
      </div>
    </div>
  );
}

export default function AsistenciaPage() {
  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <Suspense fallback={<div className="text-slate-400">Cargando aplicación...</div>}>
        <StudentAttendanceForm />
      </Suspense>
    </main>
  );
}
