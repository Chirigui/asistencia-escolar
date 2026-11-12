"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  GraduationCap,
  PlusCircle,
  QrCode,
  Users,
  LogOut,
  X,
  CheckCircle,
  Download,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import {
  buildCsv,
  isImportHeaderRow,
  parseDelimited,
} from "@/lib/csv";

interface SessionListItem {
  id: string;
  code: string;
  subject: string;
  groupName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  presents: number;
  total: number;
}

interface SessionDetailSession {
  id: string;
  code: string;
  subject: string;
  group_name: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
}

interface PresentRow {
  attendanceId: string;
  registeredAt: string;
  status: string;
  method: string;
  notes: string | null;
  document: string;
  fullName: string;
  grade: string;
  groupName: string;
}

interface AbsentRow {
  id: string;
  document: string;
  fullName: string;
  grade: string;
  groupName: string;
}

interface SessionDetail {
  session: SessionDetailSession;
  sessionUrl: string;
  qrDataUrl: string;
  stats: {
    total: number;
    presentsCount: number;
    absentsCount: number;
  };
  presents: PresentRow[];
  absents: AbsentRow[];
}

interface ReportRow {
  id: string;
  sessionCode: string;
  subject: string;
  sessionGroup: string;
  date: string;
  registeredAt: string;
  document: string;
  studentName: string;
  grade: string;
  group: string;
  status: string;
  method: string;
}

interface ImportPreviewRow {
  row: number;
  document: string;
  fullName: string;
  grade: string;
  groupName: string;
  status: string;
  valid: boolean;
  errors: string[];
}

interface ImportPreview {
  success: boolean;
  dryRun: boolean;
  summary: {
    total: number;
    valid: number;
    duplicates: number;
    invalid: number;
    inserted: number;
  };
  preview: ImportPreviewRow[];
  message?: string;
}

function todayInputValue(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export default function TeacherPanelPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"clases" | "reportes" | "importar">("clases");
  const [userProfile, setUserProfile] = useState<{ email?: string; role?: string } | null>(null);

  // Estados de sesiones
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessionsError, setSessionsError] = useState("");

  // Modal nueva clase
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    subject: "",
    groupName: "10A",
    date: todayInputValue(),
    startTime: "07:00",
    endTime: "08:30",
  });
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
  const [reportsTruncated, setReportsTruncated] = useState(false);
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

  const loadSessions = useCallback(async () => {
    try {
      setLoadingSessions(true);
      setSessionsError("");

      const res = await fetch("/api/sessions");
      if (res.status === 401) {
        router.push("/login");
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setSessionsError(data.message || "No fue posible cargar las sesiones.");
        return;
      }

      setSessions(data.sessions || []);
    } catch (err) {
      console.error(err);
      setSessionsError("Error de conexión al cargar las sesiones.");
    } finally {
      setLoadingSessions(false);
    }
  }, [router]);

  // Carga inicial y verificación de Auth
  useEffect(() => {
    const checkAuthAndLoad = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      setUserProfile({ email: user.email });
      loadSessions();
    };

    checkAuthAndLoad();
  }, [router, loadSessions]);

  const handleLogout = async () => {
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
      console.error(err);
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
      !window.confirm(
        "¿Cerrar la toma de asistencia? Los estudiantes ya no podrán registrarse."
      )
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
      console.error(err);
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
      console.error(err);
      alert("Error de conexión al registrar asistencia manual.");
    } finally {
      setManualSubmitting(false);
    }
  };

  const loadReports = async () => {
    setLoadingReports(true);
    setReportsError("");
    setReportsTruncated(false);

    try {
      const params = new URLSearchParams();
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

      setReports(data.rows || []);
      setReportsTruncated(Boolean(data.truncated));
    } catch (err) {
      console.error(err);
      setReports([]);
      setReportsError("Error de conexión al generar el reporte.");
    } finally {
      setLoadingReports(false);
    }
  };

  const exportReportsCsv = () => {
    if (reports.length === 0) return;

    const headers = [
      "Sesion",
      "Fecha",
      "Hora",
      "Documento",
      "Estudiante",
      "Grado",
      "Grupo",
      "Materia",
      "Metodo",
      "Estado",
    ];
    const rows = reports.map((r) => [
      r.sessionCode,
      r.date,
      new Date(r.registeredAt).toLocaleTimeString("es-CO", { hour12: false }),
      r.document,
      r.studentName,
      r.grade,
      r.group,
      r.subject,
      r.method,
      r.status,
    ]);
    const csvContent = buildCsv(headers, rows);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `reporte_asistencia_${todayInputValue()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleParseAndImport = async (dryRun: boolean) => {
    if (!importCsvText.trim() || importing) return;
    setImporting(true);
    setImportSuccessMsg("");

    try {
      // Parser con soporte para comillas y comas dentro de campos.
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
          `¡Éxito! Se importaron ${data.summary.inserted} estudiantes correctamente.`
        );
        setImportCsvText("");
      }
    } catch (err) {
      console.error(err);
      alert("Error de conexión durante la importación.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Barra de navegación superior */}
      <header className="h-16 border-b border-slate-800 bg-slate-900/60 backdrop-blur-md px-4 sm:px-8 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-600/30">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold leading-tight">Panel Docente y Administrativo</h1>
            <p className="text-[11px] text-slate-400 font-mono">{userProfile?.email || "Cargando..."}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <nav className="flex items-center bg-slate-800/80 p-1 rounded-xl border border-slate-700/50 text-xs">
            <button
              onClick={() => setActiveTab("clases")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === "clases" ? "bg-blue-600 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
            >
              Clases y QR
            </button>
            <button
              onClick={() => {
                setActiveTab("reportes");
                loadReports();
              }}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === "reportes" ? "bg-blue-600 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
            >
              Reportes
            </button>
            <button
              onClick={() => setActiveTab("importar")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === "importar" ? "bg-blue-600 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
            >
              Importar Matrícula
            </button>
          </nav>

          <button
            onClick={handleLogout}
            title="Cerrar sesión"
            className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950/60 hover:text-rose-400 border border-slate-700 transition-colors text-slate-400"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Contenido según pestaña */}
      <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
        {/* PESTAÑA: CLASES Y QR */}
        {activeTab === "clases" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">Sesiones de Clase</h2>
                <p className="text-xs text-slate-400">
                  Crea una sesión, proyecta su código QR gigante y monitorea asistencia en tiempo real.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={loadSessions}
                  title="Actualizar sesiones"
                  aria-label="Actualizar sesiones"
                  className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 transition-colors text-slate-300"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-blue-600/20 transition-all"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Nueva Clase</span>
                </button>
              </div>
            </div>

            {sessionsError && (
              <div
                role="alert"
                className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{sessionsError}</span>
              </div>
            )}

            {loadingSessions ? (
              <div className="py-20 text-center text-slate-500 text-sm">
                Cargando sesiones...
              </div>
            ) : sessions.length === 0 ? (
              <div className="p-12 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-900/30">
                <QrCode className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <h3 className="font-semibold text-slate-300">No hay sesiones creadas</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Crea tu primera clase para generar el código QR de asistencia y proyectarlo a tus alumnos.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                    className="p-5 bg-slate-900 border border-slate-800 rounded-2xl hover:border-blue-500/50 hover:bg-slate-900/80 focus:outline-none focus:ring-2 focus:ring-blue-500/60 cursor-pointer transition-all flex flex-col justify-between group"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-mono font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20">
                          {ses.code}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            ses.status === "ABIERTA"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {ses.status}
                        </span>
                      </div>
                      <h3 className="font-bold text-base text-white group-hover:text-blue-400 transition-colors">
                        {ses.subject}
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        Grupo <span className="text-slate-200 font-semibold">{ses.groupName}</span> · {ses.date}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {ses.startTime.slice(0, 5)} - {ses.endTime.slice(0, 5)}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 text-slate-300">
                        <Users className="w-3.5 h-3.5 text-slate-500" />
                        <span>
                          <strong className="text-white">{ses.presents}</strong> / {ses.total} presentes
                        </span>
                      </div>
                      <span className="text-blue-400 text-xs font-medium group-hover:translate-x-0.5 transition-transform">
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
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">Reportes de Asistencia</h2>
                <p className="text-xs text-slate-400">
                  Filtra por fechas, grupo y materias, y exporta en formato CSV para Excel.
                </p>
              </div>

              <button
                onClick={exportReportsCsv}
                disabled={reports.length === 0}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all text-white"
              >
                <Download className="w-4 h-4" />
                <span>Exportar CSV</span>
              </button>
            </div>

            {/* Filtros */}
            <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl grid grid-cols-1 sm:grid-cols-5 gap-3 text-xs">
              <div>
                <label htmlFor="report-date-from" className="block text-slate-400 mb-1">
                  Fecha Desde
                </label>
                <input
                  id="report-date-from"
                  type="date"
                  value={reportFilters.dateFrom}
                  onChange={(e) => setReportFilters({ ...reportFilters, dateFrom: e.target.value })}
                  className="w-full p-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                />
              </div>
              <div>
                <label htmlFor="report-date-to" className="block text-slate-400 mb-1">
                  Fecha Hasta
                </label>
                <input
                  id="report-date-to"
                  type="date"
                  value={reportFilters.dateTo}
                  onChange={(e) => setReportFilters({ ...reportFilters, dateTo: e.target.value })}
                  className="w-full p-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                />
              </div>
              <div>
                <label htmlFor="report-group" className="block text-slate-400 mb-1">
                  Grupo
                </label>
                <input
                  id="report-group"
                  type="text"
                  maxLength={20}
                  placeholder="Ej: 10A"
                  value={reportFilters.groupName}
                  onChange={(e) => setReportFilters({ ...reportFilters, groupName: e.target.value })}
                  className="w-full p-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                />
              </div>
              <div>
                <label htmlFor="report-subject" className="block text-slate-400 mb-1">
                  Materia
                </label>
                <input
                  id="report-subject"
                  type="text"
                  maxLength={120}
                  placeholder="Ej: Matemáticas"
                  value={reportFilters.subject}
                  onChange={(e) => setReportFilters({ ...reportFilters, subject: e.target.value })}
                  className="w-full p-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={loadReports}
                  disabled={loadingReports}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 rounded-lg font-semibold text-white transition-colors"
                >
                  {loadingReports ? "Consultando..." : "Aplicar Filtros"}
                </button>
              </div>
            </div>

            {reportsError && (
              <div
                role="alert"
                className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{reportsError}</span>
              </div>
            )}

            {reportsTruncated && (
              <div
                role="status"
                className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs"
              >
                El reporte supera las 10.000 filas y fue truncado. Ajusta el rango de
                fechas o los filtros para exportar el resto.
              </div>
            )}

            {/* Tabla de registros */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">
                  Total de registros encontrados: <strong className="text-white">{reports.length}</strong>
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 font-medium border-b border-slate-800">
                    <tr>
                      <th className="p-3">Sesión</th>
                      <th className="p-3">Fecha</th>
                      <th className="p-3">Hora</th>
                      <th className="p-3">Documento</th>
                      <th className="p-3">Estudiante</th>
                      <th className="p-3">Grupo</th>
                      <th className="p-3">Materia</th>
                      <th className="p-3">Método</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {reports.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="p-3 font-mono font-bold text-blue-400">{row.sessionCode}</td>
                        <td className="p-3">{row.date}</td>
                        <td className="p-3 font-mono">{new Date(row.registeredAt).toLocaleTimeString().slice(0, 5)}</td>
                        <td className="p-3 font-mono">{row.document}</td>
                        <td className="p-3 font-medium text-white">{row.studentName}</td>
                        <td className="p-3">{row.group}</td>
                        <td className="p-3">{row.subject}</td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              row.method === "QR"
                                ? "bg-blue-500/10 text-blue-400"
                                : "bg-purple-500/10 text-purple-400"
                            }`}
                          >
                            {row.method}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {reports.length === 0 && !loadingReports && (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-500">
                          No hay registros que coincidan con la búsqueda.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* PESTAÑA: IMPORTADOR MASIVO */}
        {activeTab === "importar" && (
          <div className="space-y-6 max-w-4xl">
            <div>
              <h2 className="text-xl font-bold">Importador Masivo de Estudiantes</h2>
              <p className="text-xs text-slate-400">
                Pega directamente tus filas de Excel o CSV con las columnas: <br />
                <code className="text-blue-400 font-mono">Documento, Nombre Completo, Grado, Grupo, Estado</code>
              </p>
            </div>

            {importSuccessMsg && (
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-2xl text-xs flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
                <span>{importSuccessMsg}</span>
              </div>
            )}

            <div className="space-y-3">
              <textarea
                rows={7}
                maxLength={500_000}
                spellCheck={false}
                aria-label="Filas de estudiantes para importar"
                value={importCsvText}
                onChange={(e) => setImportCsvText(e.target.value)}
                placeholder={"1000000020,Estudiante Ejemplo Uno,10,10A,ACTIVO\n1000000021,Estudiante Ejemplo Dos,10,10A,ACTIVO"}
                className="w-full p-4 bg-slate-900 border border-slate-800 rounded-2xl font-mono text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
              />

              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleParseAndImport(true)}
                  disabled={importing || !importCsvText.trim()}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-colors"
                >
                  Previsualizar y Validar
                </button>
                <button
                  onClick={() => handleParseAndImport(false)}
                  disabled={importing || !importCsvText.trim()}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-lg shadow-blue-600/20 transition-colors"
                >
                  Importar a Base de Datos
                </button>
              </div>
            </div>

            {importPreview && (
              <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
                <div className="grid grid-cols-4 gap-3 text-center text-xs">
                  <div className="p-3 bg-slate-950 rounded-xl">
                    <p className="text-slate-500">Filas Totales</p>
                    <p className="text-lg font-bold text-white mt-1">{importPreview.summary.total}</p>
                  </div>
                  <div className="p-3 bg-slate-950 rounded-xl">
                    <p className="text-slate-500">Válidas</p>
                    <p className="text-lg font-bold text-emerald-400 mt-1">{importPreview.summary.valid}</p>
                  </div>
                  <div className="p-3 bg-slate-950 rounded-xl">
                    <p className="text-slate-500">Duplicados</p>
                    <p className="text-lg font-bold text-amber-400 mt-1">{importPreview.summary.duplicates}</p>
                  </div>
                  <div className="p-3 bg-slate-950 rounded-xl">
                    <p className="text-slate-500">Inválidos</p>
                    <p className="text-lg font-bold text-rose-400 mt-1">{importPreview.summary.invalid}</p>
                  </div>
                </div>

                <div className="overflow-x-auto max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950 text-slate-400 sticky top-0">
                      <tr>
                        <th className="p-2">#</th>
                        <th className="p-2">Doc</th>
                        <th className="p-2">Nombre</th>
                        <th className="p-2">Grupo</th>
                        <th className="p-2">Diagnóstico</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {importPreview.preview.map((p) => (
                        <tr key={p.row}>
                          <td className="p-2 font-mono text-slate-500">{p.row}</td>
                          <td className="p-2 font-mono">{p.document}</td>
                          <td className="p-2">{p.fullName}</td>
                          <td className="p-2">{p.groupName}</td>
                          <td className="p-2">
                            {p.valid ? (
                              <span className="text-emerald-400 font-bold">Válido</span>
                            ) : (
                              <span className="text-rose-400">{p.errors.join(", ")}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
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
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl relative">
            <button
              onClick={() => setShowCreateModal(false)}
              aria-label="Cerrar creación de clase"
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 id="create-session-title" className="text-lg font-bold mb-1">
              Crear Nueva Clase
            </h3>
            <p className="text-xs text-slate-400 mb-5">Define la asignatura y el grupo para generar el código QR.</p>

            <form onSubmit={handleCreateSession} className="space-y-4 text-xs">
              <div>
                <label htmlFor="create-subject" className="block text-slate-300 mb-1">
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
                  className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="create-group" className="block text-slate-300 mb-1">
                    Grupo
                  </label>
                  <input
                    id="create-group"
                    type="text"
                    required
                    maxLength={20}
                    placeholder="Ej: 10A"
                    value={createForm.groupName}
                    onChange={(e) => setCreateForm({ ...createForm, groupName: e.target.value })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white"
                  />
                </div>
                <div>
                  <label htmlFor="create-date" className="block text-slate-300 mb-1">
                    Fecha
                  </label>
                  <input
                    id="create-date"
                    type="date"
                    required
                    value={createForm.date}
                    onChange={(e) => setCreateForm({ ...createForm, date: e.target.value })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="create-start-time" className="block text-slate-300 mb-1">
                    Hora Inicio
                  </label>
                  <input
                    id="create-start-time"
                    type="time"
                    required
                    value={createForm.startTime}
                    onChange={(e) => setCreateForm({ ...createForm, startTime: e.target.value })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white"
                  />
                </div>
                <div>
                  <label htmlFor="create-end-time" className="block text-slate-300 mb-1">
                    Hora Fin
                  </label>
                  <input
                    id="create-end-time"
                    type="time"
                    required
                    value={createForm.endTime}
                    onChange={(e) => setCreateForm({ ...createForm, endTime: e.target.value })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={creating}
                className="w-full mt-2 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-semibold rounded-xl text-sm transition-all shadow-lg shadow-blue-600/20"
              >
                {creating ? "Generando sesión..." : "Crear y Mostrar QR"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DETALLE DE SESIÓN / PROYECTOR QR */}
      {selectedSessionId && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-detail-title"
        >
          <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl relative my-auto">
            <button
              onClick={() => setSelectedSessionId(null)}
              aria-label="Cerrar detalle de sesión"
              className="absolute right-4 top-4 text-slate-400 hover:text-white p-1"
            >
              <X className="w-6 h-6" />
            </button>

            {loadingDetail ? (
              <div className="py-24 text-center text-slate-400 text-sm">
                Cargando detalles de la clase...
              </div>
            ) : detailError ? (
              <div
                role="alert"
                className="my-12 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{detailError}</span>
              </div>
            ) : !sessionDetail ? (
              <div className="py-24 text-center text-slate-400 text-sm">
                No hay información disponible.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Lado Izquierdo: QR Gigante para proyector */}
                <div className="flex flex-col items-center justify-center p-6 bg-slate-950 border border-slate-800 rounded-2xl text-center">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono font-bold text-xs px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                      CÓDIGO: {sessionDetail.session.code}
                    </span>
                    <button
                      onClick={() => toggleSessionStatus(sessionDetail.session.status)}
                      disabled={statusUpdating}
                      aria-busy={statusUpdating}
                      className={`text-xs font-bold px-3 py-0.5 rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        sessionDetail.session.status === "ABIERTA"
                          ? "bg-rose-500/20 border-rose-500/30 text-rose-300 hover:bg-rose-500/30"
                          : "bg-emerald-500/20 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30"
                      }`}
                    >
                      {statusUpdating
                        ? "Actualizando..."
                        : sessionDetail.session.status === "ABIERTA"
                          ? "Cerrar Asistencia"
                          : "Reabrir Asistencia"}
                    </button>
                  </div>

                  <h3 id="session-detail-title" className="text-xl font-bold text-white mb-1">
                    {sessionDetail.session.subject}
                  </h3>
                  <p className="text-xs text-slate-400 mb-4">
                    Grupo <strong>{sessionDetail.session.group_name}</strong> · {sessionDetail.session.date}
                  </p>

                  {/* QR Image nativa */}
                  <div className="p-3 bg-white rounded-2xl shadow-2xl mb-3">
                    <img
                      src={sessionDetail.qrDataUrl}
                      alt="Código QR de Asistencia"
                      className="w-56 h-56 sm:w-64 sm:h-64 object-contain"
                    />
                  </div>

                  <p className="text-xs text-slate-400 font-mono break-all max-w-xs">
                    {sessionDetail.sessionUrl}
                  </p>
                </div>

                {/* Lado Derecho: Asistencia en Vivo */}
                <div className="flex flex-col h-full justify-between">
                  <div>
                    {/* Estadísticas rápidas */}
                    <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                      <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl">
                        <p className="text-[10px] text-slate-500">Total Grupo</p>
                        <p className="text-base font-bold text-white">{sessionDetail.stats.total}</p>
                      </div>
                      <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl">
                        <p className="text-[10px] text-slate-500">Presentes</p>
                        <p className="text-base font-bold text-emerald-400">{sessionDetail.stats.presentsCount}</p>
                      </div>
                      <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl">
                        <p className="text-[10px] text-slate-500">Ausentes</p>
                        <p className="text-base font-bold text-rose-400">{sessionDetail.stats.absentsCount}</p>
                      </div>
                    </div>

                    {/* Marcado Manual Rápido */}
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl mb-4 text-xs">
                      <p className="font-semibold text-slate-300 mb-2">Marcado Manual Docente</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          maxLength={40}
                          aria-label="Documento del estudiante para marcado manual"
                          placeholder="Documento del alumno"
                          value={manualDocument}
                          onChange={(e) => setManualDocument(e.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              handleManualAttendance();
                            }
                          }}
                          className="flex-1 p-2 bg-slate-900 border border-slate-800 rounded-lg text-white"
                        />
                        <button
                          onClick={() => handleManualAttendance()}
                          disabled={manualSubmitting || !manualDocument.trim()}
                          className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-semibold"
                        >
                          {manualSubmitting ? "Marcando..." : "Marcar"}
                        </button>
                      </div>
                    </div>

                    {/* Lista de Presentes y Ausentes */}
                    <div className="text-xs mb-2 flex items-center justify-between">
                      <span className="font-bold text-slate-300">Lista de la sesión</span>
                      <input
                        type="text"
                        maxLength={80}
                        aria-label="Filtrar estudiantes por nombre"
                        placeholder="Filtrar por nombre..."
                        value={searchFilter}
                        onChange={(e) => setSearchFilter(e.target.value.toLowerCase())}
                        className="px-2 py-1 bg-slate-950 border border-slate-800 rounded text-slate-200 text-[11px]"
                      />
                    </div>

                    <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1 text-xs">
                      {/* Presentes */}
                      {sessionDetail.presents
                        .filter((p) => p.fullName.toLowerCase().includes(searchFilter))
                        .map((p) => (
                          <div
                            key={p.attendanceId}
                            className="p-2 bg-emerald-950/20 border border-emerald-500/20 rounded-xl flex items-center justify-between"
                          >
                            <div>
                              <p className="font-bold text-emerald-300">{p.fullName}</p>
                              <p className="text-[10px] text-slate-500 font-mono">{p.document}</p>
                            </div>
                            <span className="text-[10px] font-mono text-emerald-400">
                              {new Date(p.registeredAt).toLocaleTimeString().slice(0, 5)}
                            </span>
                          </div>
                        ))}

                      {/* Ausentes */}
                      {sessionDetail.absents
                        .filter((a) => a.fullName.toLowerCase().includes(searchFilter))
                        .map((a) => (
                          <div
                            key={a.id}
                            className="p-2 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between"
                          >
                            <div>
                              <p className="font-medium text-slate-300">{a.fullName}</p>
                              <p className="text-[10px] text-slate-500 font-mono">{a.document}</p>
                            </div>
                            <button
                              onClick={() => handleManualAttendance(a.document)}
                              className="px-2 py-1 bg-slate-800 hover:bg-blue-600 rounded text-[10px] text-slate-300 hover:text-white transition-colors"
                            >
                              + Presente
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800 mt-4 text-right">
                    <button
                      onClick={() => openSessionDetail(sessionDetail.session.id)}
                      className="text-xs text-blue-400 hover:underline flex items-center gap-1 ml-auto"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Actualizar lista</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
