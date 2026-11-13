"use client";
import type { Dispatch, SetStateAction } from "react";
import type { ReportRow } from "@/types/teacher";
import { Download, AlertCircle } from "lucide-react";
interface Props {
  reports: ReportRow[];
  loadingReports: boolean;
  reportsError: string;
  reportFilters: { dateFrom: string; dateTo: string; groupName: string; subject: string };
  setReportFilters: Dispatch<SetStateAction<Props["reportFilters"]>>;
  loadReports: () => void;
  exportReportsCsv: () => void;
}
export default function ReportsPanel({
  reports,
  loadingReports,
  reportsError,
  reportFilters,
  setReportFilters,
  loadReports,
  exportReportsCsv,
}: Props) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Reportes de Asistencia</h2>
          <p className="text-xs text-slate-600">
            Filtra por fechas, grupo y materias, y exporta en formato CSV para Excel.
          </p>
        </div>

        <button
          onClick={exportReportsCsv}
          disabled={reports.length === 0}
          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-100 disabled:text-slate-600 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all text-slate-900"
        >
          <Download className="w-4 h-4" />
          <span>Exportar CSV</span>
        </button>
      </div>

      {/* Filtros */}
      <div className="p-4 bg-white border border-slate-200 rounded-2xl grid grid-cols-1 sm:grid-cols-5 gap-3 text-xs">
        <div>
          <label htmlFor="report-date-from" className="block text-slate-600 mb-1">
            Fecha Desde
          </label>
          <input
            id="report-date-from"
            type="date"
            value={reportFilters.dateFrom}
            onChange={(e) => setReportFilters({ ...reportFilters, dateFrom: e.target.value })}
            className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
          />
        </div>
        <div>
          <label htmlFor="report-date-to" className="block text-slate-600 mb-1">
            Fecha Hasta
          </label>
          <input
            id="report-date-to"
            type="date"
            value={reportFilters.dateTo}
            onChange={(e) => setReportFilters({ ...reportFilters, dateTo: e.target.value })}
            className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
          />
        </div>
        <div>
          <label htmlFor="report-group" className="block text-slate-600 mb-1">
            Grupo
          </label>
          <input
            id="report-group"
            type="text"
            maxLength={20}
            placeholder="Ej: 10A"
            value={reportFilters.groupName}
            onChange={(e) => setReportFilters({ ...reportFilters, groupName: e.target.value })}
            className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
          />
        </div>
        <div>
          <label htmlFor="report-subject" className="block text-slate-600 mb-1">
            Materia
          </label>
          <input
            id="report-subject"
            type="text"
            maxLength={120}
            placeholder="Ej: Matemáticas"
            value={reportFilters.subject}
            onChange={(e) => setReportFilters({ ...reportFilters, subject: e.target.value })}
            className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={loadReports}
            disabled={loadingReports}
            className="w-full py-2 bg-teal-700 text-white hover:bg-teal-800 disabled:bg-slate-100 disabled:text-slate-500 rounded-lg font-semibold  transition-colors"
          >
            {loadingReports ? "Consultando..." : "Aplicar Filtros"}
          </button>
        </div>
      </div>

      {reportsError && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-700 text-xs flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{reportsError}</span>
        </div>
      )}

      {/* Tabla de registros */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between text-xs">
          <span className="text-slate-600 font-medium">
            Total de registros encontrados:{" "}
            <strong className="text-slate-900">{reports.length}</strong>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200">
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
                <tr key={row.id} className="hover:bg-slate-100/40 transition-colors">
                  <td className="p-3 font-mono font-bold text-teal-700">{row.sessionCode}</td>
                  <td className="p-3">{row.date}</td>
                  <td className="p-3 font-mono">
                    {new Date(row.registeredAt).toLocaleTimeString().slice(0, 5)}
                  </td>
                  <td className="p-3 font-mono">{row.document}</td>
                  <td className="p-3 font-medium text-slate-900">{row.studentName}</td>
                  <td className="p-3">{row.group}</td>
                  <td className="p-3">{row.subject}</td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        row.method === "QR"
                          ? "bg-blue-500/10 text-teal-700"
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
  );
}
