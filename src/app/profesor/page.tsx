"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { AcademicData } from "@/types/academic";
import { sessionWindow } from "@/lib/session-window";
const ReportsPanel = dynamic(() => import("@/components/teacher/reports-panel"), {
  loading: () => (
    <p role="status" className="p-8">
      Cargando reportes…
    </p>
  ),
});
const ImportPanel = dynamic(() => import("@/components/teacher/import-panel"), {
  loading: () => (
    <p role="status" className="p-8">
      Cargando importador…
    </p>
  ),
});
const SessionDialog = dynamic(() => import("@/components/teacher/session-dialog"));
const AcademicPanel = dynamic(() => import("@/components/teacher/academic-panel"));
import {
  GraduationCap,
  PlusCircle,
  QrCode,
  Users,
  LogOut,
  X,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

import type { SessionListItem, SessionDetail, ReportRow, ImportPreview } from "@/types/teacher";

export default function TeacherPanelPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"clases" | "reportes" | "importar" | "academico">(
    "clases",
  );
  const [userProfile, setUserProfile] = useState<{ email?: string; role?: string } | null>(null);

  const [academic, setAcademic] = useState<AcademicData | null>(null);
  const [nextSessionCursor, setNextSessionCursor] = useState<string | null>(null);
  const [nextReportCursor, setNextReportCursor] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState("");
  // Estados de sesiones
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessionsError, setSessionsError] = useState("");

  // Modal nueva clase
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState(() => ({
    subject: "",
    groupName: "",
    ...sessionWindow(),
    startNow: true,
  }));
  const [creating, setCreating] = useState(false);

  // Modal detalle de sesión / Proyector QR
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [manualDocument, setManualDocument] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");

  // Estados de reportes
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [reportsError, setReportsError] = useState("");
  const [reportFilters, setReportFilters] = useState({
    dateFrom: "",
    dateTo: "",
    groupName: "",
    subject: "",
  });

  // Estados de importación masiva
  const [importCsvText, setImportCsvText] = useState("");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSuccessMsg, setImportSuccessMsg] = useState("");

  // Keep keyboard focus inside the active dialog and restore its trigger.
  useEffect(() => {
    if (!showCreateModal) return;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowCreateModal(false);
        setSelectedSessionId(null);
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [showCreateModal]);

  const loadSessions = useCallback(
    async (cursor: string | null = null) => {
      try {
        setLoadingSessions(true);
        setSessionsError("");

        const res = await fetch(
          "/api/sessions" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
          { cache: "no-store" },
        );
        if (res.status === 401) {
          router.push("/login");
          return;
        }

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          setSessionsError(data.message || "No fue posible cargar las sesiones.");
          return;
        }

        setSessions((previous) =>
          cursor ? [...previous, ...(data.sessions || [])] : data.sessions || [],
        );
        setNextSessionCursor(data.nextCursor || null);
        setLastUpdated(
          new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }),
        );
      } catch (err) {
        void err;
        setSessionsError("Error de conexión al cargar las sesiones.");
      } finally {
        setLoadingSessions(false);
      }
    },
    [router],
  );

  const loadAcademic = useCallback(async () => {
    try {
      const response = await fetch("/api/academic", { cache: "no-store" });
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      const data = await response.json();
      if (data.success) {
        setAcademic(data);
        setUserProfile({ email: data.email, role: data.role });
      } else setSessionsError(data.message || "No fue posible cargar los grupos asignados.");
    } catch {
      setSessionsError("No fue posible cargar la organización académica.");
    }
  }, [router]);
  useEffect(() => {
    const load = async () => {
      await Promise.all([loadSessions(), loadAcademic()]);
    };
    void load();
  }, [loadSessions, loadAcademic]);

  const handleLogout = async () => {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      const data = await res.json();
      if (data.success) {
        setShowCreateModal(false);
        loadSessions();
        openSessionDetail(data.session.id);
      } else {
        alert(data.message || "Error al crear la clase.");
      }
    } catch {
      alert("Error de conexión al crear clase.");
    } finally {
      setCreating(false);
    }
  };

  const openSessionDetail = async (id: string) => {
    setSelectedSessionId(id);
    setLoadingDetail(true);
    setDetailError("");
    setSessionDetail(null);

    try {
      const res = await fetch(`/api/sessions/${id}`);
      if (res.status === 401) {
        router.push("/login");
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setDetailError(data.message || "No fue posible cargar la sesión.");
        return;
      }

      setSessionDetail(data);
    } catch (err) {
      void err;
      setDetailError("Error de conexión al cargar la sesión.");
    } finally {
      setLoadingDetail(false);
    }
  };

  const toggleSessionStatus = async (currentStatus: string) => {
    if (!selectedSessionId || statusUpdating) return;

    const nextStatus = currentStatus === "ABIERTA" ? "CERRADA" : "ABIERTA";
    if (
      nextStatus === "CERRADA" &&
      !window.confirm("¿Cerrar la toma de asistencia? Los estudiantes ya no podrán registrarse.")
    ) {
      return;
    }

    setStatusUpdating(true);
    try {
      const res = await fetch(`/api/sessions/${selectedSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        alert(data.message || "No fue posible actualizar la sesión.");
        return;
      }

      await openSessionDetail(selectedSessionId);
      await loadSessions();
    } catch (err) {
      void err;
      alert("Error de conexión al actualizar la sesión.");
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleManualAttendance = async (documentToMark?: string) => {
    const doc = (documentToMark || manualDocument).trim();
    if (!doc || !selectedSessionId || manualSubmitting) return;

    setManualSubmitting(true);
    try {
      const res = await fetch("/api/attendance/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: selectedSessionId,
          document: doc,
          notes: manualNote || "Marcado manual docente",
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        alert(data.message || "No fue posible registrar la asistencia.");
        return;
      }

      setManualDocument("");
      setManualNote("");
      await openSessionDetail(selectedSessionId);
      await loadSessions();
    } catch (err) {
      void err;
      alert("Error de conexión al registrar asistencia manual.");
    } finally {
      setManualSubmitting(false);
    }
  };

  const loadReports = async (cursor: string | null = null) => {
    setLoadingReports(true);
    setReportsError("");

    try {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (reportFilters.dateFrom) params.append("dateFrom", reportFilters.dateFrom);
      if (reportFilters.dateTo) params.append("dateTo", reportFilters.dateTo);
      if (reportFilters.groupName) params.append("groupName", reportFilters.groupName);
      if (reportFilters.subject) params.append("subject", reportFilters.subject);

      const res = await fetch(`/api/reports?${params.toString()}`);
      if (res.status === 401) {
        router.push("/login");
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setReports([]);
        setReportsError(data.message || "No fue posible generar el reporte.");
        return;
      }

      setReports((previous) => (cursor ? [...previous, ...(data.rows || [])] : data.rows || []));
      setNextReportCursor(data.nextCursor || null);
    } catch (err) {
      void err;
      setReports([]);
      setReportsError("Error de conexión al generar el reporte.");
    } finally {
      setLoadingReports(false);
    }
  };

  const exportReportsCsv = async () => {
    setReportsError("");
    try {
      const response = await fetch(
        "/api/reports/export?" + new URLSearchParams(reportFilters).toString(),
      );
      if (!response.ok) {
        const data = await response.json();
        setReportsError(data.message || "No fue posible exportar.");
        return;
      }
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = "asistencia.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setReportsError("La descarga fue interrumpida. Intenta de nuevo.");
    }
  };

  const handleParseAndImport = async (dryRun: boolean) => {
    if (!importCsvText.trim() || importing) return;
    setImporting(true);
    setImportSuccessMsg("");

    try {
      // Parser con soporte para comillas y comas dentro de campos.
      const { parseDelimited, isImportHeaderRow } = await import("@/lib/csv");
      const parsed = parseDelimited(importCsvText);
      const firstDataRow = parsed.length > 0 && isImportHeaderRow(parsed[0]) ? 1 : 0;
      const rows = parsed
        .slice(firstDataRow)
        .map((parts) => ({
          document: (parts[0] || "").trim(),
          fullName: (parts[1] || "").trim(),
          grade: (parts[2] || "").trim(),
          groupName: (parts[3] || "").trim(),
          status: (parts[4] || "ACTIVO").trim(),
        }))
        .filter((row) => row.document);

      if (rows.length === 0) {
        alert("No se detectaron filas válidas para importar.");
        return;
      }

      if (rows.length > 2000) {
        alert("La importación admite como máximo 2000 filas por lote.");
        return;
      }

      const res = await fetch("/api/students/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, dryRun }),
      });

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        alert(data.message || "Error en importación");
        return;
      }

      setImportPreview(data);
      if (!dryRun) {
        setImportSuccessMsg(
          `¡Éxito! Se importaron ${data.summary.inserted} estudiantes correctamente.`,
        );
        setImportCsvText("");
      }
    } catch (err) {
      void err;
      alert("Error de conexión durante la importación.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Barra de navegación superior */}
      <header className="min-h-20 gap-4 flex-wrap py-4 border-b border-slate-200 bg-white/60  px-4 sm:px-8 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-teal-700 text-white flex items-center justify-center font-bold  shadow-lg shadow-teal-900/10">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold leading-tight">Asistencia · Espacio docente</h1>
            <p className="text-[11px] text-slate-600 font-mono">
              {userProfile?.email || "Cargando..."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto overflow-x-auto">
          <nav className="flex items-center bg-slate-100/80 p-1 rounded-xl border border-slate-200/50 text-xs">
            <button
              aria-pressed={activeTab === "clases"}
              onClick={() => setActiveTab("clases")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === "clases"
                  ? "bg-teal-700 text-white  shadow"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Clases y QR
            </button>
            <button
              onClick={() => {
                setActiveTab("reportes");
                void loadReports();
              }}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === "reportes"
                  ? "bg-teal-700 text-white  shadow"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Reportes
            </button>
            {userProfile?.role === "admin" && (
              <button
                onClick={() => setActiveTab("importar")}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                  activeTab === "importar"
                    ? "bg-teal-700 text-white  shadow"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Importar Matrícula
              </button>
            )}
            {userProfile?.role === "admin" && (
              <button
                onClick={() => setActiveTab("academico")}
                className="px-3 py-1.5 rounded-lg"
                aria-pressed={activeTab === "academico"}
              >
                Organización
              </button>
            )}
          </nav>

          <button
            onClick={handleLogout}
            title="Cerrar sesión"
            className="p-2 rounded-xl bg-slate-100 hover:bg-rose-950/60 hover:text-rose-400 border border-slate-200 transition-colors text-slate-600"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>
      <section
        className="max-w-7xl w-full mx-auto px-4 sm:px-8 pt-8"
        aria-label="Resumen de sesiones cargadas"
      >
        <p className="eyebrow">TU JORNADA ESCOLAR</p>
        <p className="text-xs text-slate-600 mt-2" role="status">
          {lastUpdated
            ? `Actualizado a las ${lastUpdated} · resumen de las sesiones cargadas`
            : "Cargando sesiones…"}
        </p>
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="stat-card">
            <span>Sesiones cargadas</span>
            <strong>{sessions.length}</strong>
          </div>
          <div className="stat-card">
            <span>Abiertas</span>
            <strong>{sessions.filter((s) => s.status === "ABIERTA").length}</strong>
          </div>
          <div className="stat-card">
            <span>Registros</span>
            <strong>{sessions.reduce((sum, s) => sum + s.presents, 0)}</strong>
          </div>
        </div>
      </section>

      {/* Contenido según pestaña */}
      <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
        {/* PESTAÑA: CLASES Y QR */}
        {activeTab === "clases" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-3xl font-bold tracking-tight">Tus clases, de un vistazo</h2>
                <p className="text-xs text-slate-600">
                  Crea una sesión, proyecta su código QR gigante y revisa los registros de
                  asistencia.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => loadSessions()}
                  title="Actualizar sesiones"
                  aria-label="Actualizar sesiones"
                  className="p-2.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 transition-colors text-slate-600"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setCreateForm((form) => ({ ...form, ...sessionWindow(), startNow: true }));
                    setShowCreateModal(true);
                    void loadAcademic();
                  }}
                  className="px-4 py-2.5 bg-teal-700 text-white hover:bg-teal-800 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-teal-900/10 transition-all"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Nueva Clase</span>
                </button>
              </div>
            </div>

            {sessionsError && (
              <div
                role="alert"
                className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-700 text-xs flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{sessionsError}</span>
              </div>
            )}

            {loadingSessions ? (
              <div className="py-20 text-center text-slate-500 text-sm">Cargando sesiones...</div>
            ) : sessions.length === 0 ? (
              <div className="p-12 text-center border border-dashed border-slate-200 rounded-2xl bg-white/30">
                <QrCode className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <h3 className="font-semibold text-slate-600">No hay sesiones creadas</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Crea tu primera clase para generar el código QR de asistencia y proyectarlo a tus
                  alumnos.
                </p>
              </div>
            ) : (
              <div className="session-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {sessions.map((ses) => (
                  <div
                    key={ses.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Abrir sesión ${ses.code} de ${ses.subject}, grupo ${ses.groupName}`}
                    onClick={() => openSessionDetail(ses.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openSessionDetail(ses.id);
                      }
                    }}
                    className="p-5 bg-white border border-slate-200 rounded-2xl hover:border-blue-500/50 hover:bg-white/80 focus:outline-none focus:ring-2 focus:ring-blue-500/60 cursor-pointer transition-all flex flex-col justify-between group"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-mono font-bold text-teal-700 bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20">
                          {ses.code}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            ses.status === "ABIERTA"
                              ? "bg-emerald-500/10 text-emerald-700 border border-emerald-500/20"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {ses.status}
                        </span>
                      </div>
                      <h3 className="font-bold text-base text-slate-900 group-hover:text-teal-700 transition-colors">
                        {ses.subject}
                      </h3>
                      <p className="text-xs text-slate-600 mt-1">
                        Grupo <span className="text-slate-700 font-semibold">{ses.groupName}</span>{" "}
                        · {ses.date}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {ses.startTime.slice(0, 5)} - {ses.endTime.slice(0, 5)}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-200/80 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 text-slate-600">
                        <Users className="w-3.5 h-3.5 text-slate-500" />
                        <span>
                          <strong className="text-slate-900">{ses.presents}</strong> / {ses.total}{" "}
                          presentes
                        </span>
                      </div>
                      <span className="text-teal-700 text-xs font-medium group-hover:translate-x-0.5 transition-transform">
                        Ver panel →
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* PESTAÑA: REPORTES */}
        {activeTab === "reportes" && (
          <ReportsPanel
            reports={reports}
            loadingReports={loadingReports}
            reportsError={reportsError}
            reportFilters={reportFilters}
            setReportFilters={setReportFilters}
            loadReports={() => loadReports()}
            exportReportsCsv={exportReportsCsv}
          />
        )}

        {/* PESTAÑA: IMPORTADOR MASIVO */}
        {activeTab === "importar" && (
          <ImportPanel
            importCsvText={importCsvText}
            setImportCsvText={setImportCsvText}
            handleParseAndImport={handleParseAndImport}
            importing={importing}
            importSuccessMsg={importSuccessMsg}
            importPreview={importPreview}
          />
        )}

        {activeTab === "clases" && nextSessionCursor && (
          <button
            className="mt-6 px-5 py-3 border rounded-xl"
            disabled={loadingSessions}
            onClick={() => loadSessions(nextSessionCursor)}
          >
            Cargar más sesiones
          </button>
        )}
        {activeTab === "reportes" && nextReportCursor && (
          <button
            className="mt-6 px-5 py-3 border rounded-xl"
            disabled={loadingReports}
            onClick={() => loadReports(nextReportCursor)}
          >
            Cargar más registros
          </button>
        )}
        {activeTab === "academico" && userProfile?.role === "admin" && academic && (
          <AcademicPanel
            data={academic}
            onSaved={() => {
              void loadAcademic();
              void loadSessions();
              setReports([]);
            }}
          />
        )}
      </main>

      {/* MODAL: NUEVA CLASE */}
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-session-title"
        >
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto bg-white border border-slate-200 rounded-3xl p-6 shadow-xl shadow-slate-200/60 relative">
            <button
              onClick={() => setShowCreateModal(false)}
              aria-label="Cerrar creación de clase"
              className="absolute right-4 top-4 text-slate-600 hover:text-slate-900"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 id="create-session-title" className="text-lg font-bold mb-1">
              Crear Nueva Clase
            </h3>
            <p className="text-xs text-slate-600 mb-5">
              Define la asignatura y el grupo para generar el código QR.
            </p>

            <form onSubmit={handleCreateSession} className="space-y-4 text-xs">
              <div>
                <label htmlFor="create-subject" className="block text-slate-600 mb-1">
                  Materia / Asignatura
                </label>
                <input
                  id="create-subject"
                  type="text"
                  required
                  maxLength={120}
                  placeholder="Ej: Matemáticas Avanzadas"
                  value={createForm.subject}
                  onChange={(e) => setCreateForm({ ...createForm, subject: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="create-group" className="block text-slate-600 mb-1">
                    Grupo
                  </label>
                  <select
                    id="create-group"
                    required
                    value={createForm.groupName}
                    onChange={(e) => setCreateForm({ ...createForm, groupName: e.target.value })}
                    className="w-full p-2.5 border border-slate-200 rounded-xl"
                  >
                    <option value="">Selecciona un grupo</option>
                    {Array.from(
                      new Set(
                        academic?.role === "admin"
                          ? (academic.groups || []).map((g) => g.name)
                          : (academic?.assignments || [])
                              .filter((a) =>
                                academic?.periods.some((p) => p.id === a.period_id && p.active),
                              )
                              .map((a) => a.group.name),
                      ),
                    ).map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="create-date" className="block text-slate-600 mb-1">
                    Fecha
                  </label>
                  <input
                    id="create-date"
                    type="date"
                    readOnly={createForm.startNow}
                    required
                    value={createForm.date}
                    onChange={(e) => setCreateForm({ ...createForm, date: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900"
                  />
                </div>
              </div>

              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={createForm.startNow}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, ...sessionWindow(), startNow: e.target.checked })
                  }
                />
                Abrir ahora durante 10 minutos. La hora exacta se toma al crear, según el servidor
                (Colombia).
              </label>
              <p className="text-xs text-slate-600">
                Sin minutos de tolerancia adicionales. El QR deja de aceptar registros al terminar
                la ventana, aunque siga visible. Un QR no garantiza presencia física.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="create-start-time" className="block text-slate-600 mb-1">
                    Hora Inicio
                  </label>
                  <input
                    id="create-start-time"
                    type="time"
                    step="1"
                    readOnly={createForm.startNow}
                    required
                    value={createForm.startTime}
                    onChange={(e) => setCreateForm({ ...createForm, startTime: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900"
                  />
                </div>
                <div>
                  <label htmlFor="create-end-time" className="block text-slate-600 mb-1">
                    Hora Fin
                  </label>
                  <input
                    id="create-end-time"
                    type="time"
                    step="1"
                    readOnly={createForm.startNow}
                    required
                    value={createForm.endTime}
                    onChange={(e) => setCreateForm({ ...createForm, endTime: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={creating}
                className="w-full mt-2 py-3 bg-teal-700 text-white hover:bg-teal-800 disabled:bg-slate-100  font-semibold rounded-xl text-sm transition-all shadow-lg shadow-teal-900/10"
              >
                {creating ? "Generando sesión..." : "Crear y Mostrar QR"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DETALLE DE SESIÓN / PROYECTOR QR */}
      {selectedSessionId && (
        <SessionDialog
          setSelectedSessionId={setSelectedSessionId}
          loadingDetail={loadingDetail}
          detailError={detailError}
          sessionDetail={sessionDetail}
          toggleSessionStatus={toggleSessionStatus}
          statusUpdating={statusUpdating}
          manualDocument={manualDocument}
          setManualDocument={setManualDocument}
          handleManualAttendance={handleManualAttendance}
          manualSubmitting={manualSubmitting}
          searchFilter={searchFilter}
          setSearchFilter={setSearchFilter}
          openSessionDetail={openSessionDetail}
          manualNote={manualNote}
          setManualNote={setManualNote}
        />
      )}
    </div>
  );
}
