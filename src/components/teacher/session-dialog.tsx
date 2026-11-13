"use client";
import { useState, type Dispatch, type SetStateAction } from "react";
import { X, AlertCircle, RefreshCw } from "lucide-react";
import type { SessionDetail } from "@/types/teacher";
import dynamic from "next/dynamic";
const AuditTrail = dynamic(() => import("./audit-trail"));
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
interface Props {
  setSelectedSessionId: Dispatch<SetStateAction<string | null>>;
  loadingDetail: boolean;
  detailError: string;
  sessionDetail: SessionDetail | null;
  toggleSessionStatus: (status: string) => void;
  statusUpdating: boolean;
  manualDocument: string;
  setManualDocument: Dispatch<SetStateAction<string>>;
  handleManualAttendance: (document?: string) => void;
  manualSubmitting: boolean;
  searchFilter: string;
  setSearchFilter: Dispatch<SetStateAction<string>>;
  openSessionDetail: (id: string) => void;
  manualNote: string;
  setManualNote: Dispatch<SetStateAction<string>>;
}
export default function SessionDialog({
  setSelectedSessionId,
  loadingDetail,
  detailError,
  sessionDetail,
  toggleSessionStatus,
  statusUpdating,
  manualDocument,
  setManualDocument,
  handleManualAttendance,
  manualSubmitting,
  searchFilter,
  setSearchFilter,
  openSessionDetail,
  manualNote,
  setManualNote,
}: Props) {
  useDialogFocus(() => setSelectedSessionId(null));
  const [showAudit, setShowAudit] = useState(false);
  return (
    <div
      className="fixed inset-0 bg-black/80  z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Detalle y asistencia de clase"
    >
      <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-3xl p-6 shadow-xl shadow-slate-200/60 relative my-auto">
        <button
          onClick={() => setSelectedSessionId(null)}
          aria-label="Cerrar detalle de sesión"
          className="absolute right-4 top-4 text-slate-600 hover:text-slate-900 p-1"
        >
          <X className="w-6 h-6" />
        </button>

        {loadingDetail ? (
          <div className="py-24 text-center text-slate-600 text-sm">
            Cargando detalles de la clase...
          </div>
        ) : detailError ? (
          <div
            role="alert"
            className="my-12 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-700 text-sm flex items-start gap-3"
          >
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{detailError}</span>
          </div>
        ) : !sessionDetail ? (
          <div className="py-24 text-center text-slate-600 text-sm">
            No hay información disponible.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Lado Izquierdo: QR Gigante para proyector */}
            <div className="flex flex-col items-center justify-center p-6 bg-slate-50 border border-slate-200 rounded-2xl text-center">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono font-bold text-xs px-2.5 py-0.5 rounded-full bg-blue-500/20 text-teal-700">
                  CÓDIGO: {sessionDetail.session.code}
                </span>
                <button
                  onClick={() => toggleSessionStatus(sessionDetail.session.status)}
                  disabled={statusUpdating || sessionDetail.session.status === "FINALIZADA"}
                  aria-busy={statusUpdating}
                  className={`text-xs font-bold px-3 py-0.5 rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    sessionDetail.session.status === "ABIERTA"
                      ? "bg-rose-500/20 border-rose-500/30 text-rose-700 hover:bg-rose-500/30"
                      : "bg-emerald-500/20 border-emerald-500/30 text-emerald-800 hover:bg-emerald-500/30"
                  }`}
                >
                  {statusUpdating
                    ? "Actualizando..."
                    : sessionDetail.session.status === "ABIERTA"
                      ? "Cerrar Asistencia"
                      : sessionDetail.session.status === "FINALIZADA"
                        ? "Finalizada"
                        : "Reabrir Asistencia"}
                </button>
              </div>

              <h3
                id="session-detail-title"
                className="text-3xl font-bold tracking-tight text-slate-900 mb-1"
              >
                {sessionDetail.session.subject}
              </h3>
              <p className="text-xs text-slate-600 mb-4">
                Grupo <strong>{sessionDetail.session.group_name}</strong> ·{" "}
                {sessionDetail.session.date}
              </p>

              <p className="text-xs text-slate-600 mb-3">
                El QR de las sesiones nuevas vence a los 15 minutos. Actualiza el código para
                renovarlo. El enlace no prueba presencia física.
              </p>
              {sessionDetail.rosterReconstructed && (
                <p className="text-xs text-amber-800 mb-3">
                  Padrón antiguo reconstruido con los datos disponibles.
                </p>
              )}
              {/* QR Image nativa */}
              <div className="p-3 bg-white rounded-2xl shadow-xl shadow-slate-200/60 mb-3">
                <img
                  src={sessionDetail.qrDataUrl}
                  alt="Código QR de Asistencia"
                  width={480}
                  height={480}
                  className="w-56 h-56 sm:w-64 sm:h-64 object-contain"
                />
              </div>

              <p className="text-xs text-slate-600 font-mono break-all max-w-xs">
                {sessionDetail.sessionUrl}
              </p>
            </div>

            {/* Lado Derecho: Asistencia en Vivo */}
            <div className="flex flex-col h-full justify-between">
              <div>
                {/* Estadísticas rápidas */}
                <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <p className="text-[10px] text-slate-500">Total Grupo</p>
                    <p className="text-base font-bold text-slate-900">
                      {sessionDetail.stats.total}
                    </p>
                  </div>
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <p className="text-[10px] text-slate-500">Presentes</p>
                    <p className="text-base font-bold text-emerald-700">
                      {sessionDetail.stats.presentsCount}
                    </p>
                  </div>
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <p className="text-[10px] text-slate-500">Ausentes</p>
                    <p className="text-base font-bold text-rose-700">
                      {sessionDetail.stats.absentsCount}
                    </p>
                  </div>
                </div>

                {/* Marcado Manual Rápido */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl mb-4 text-xs">
                  <p className="font-semibold text-slate-600 mb-2">Marcado Manual Docente</p>
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
                      className="flex-1 p-2 bg-white border border-slate-200 rounded-lg text-slate-900"
                    />
                    <button
                      onClick={() => handleManualAttendance()}
                      disabled={
                        manualSubmitting ||
                        !manualDocument.trim() ||
                        sessionDetail.session.status !== "ABIERTA"
                      }
                      className="px-3 py-2 bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-50  rounded-lg font-semibold"
                    >
                      {manualSubmitting ? "Marcando..." : "Marcar"}
                    </button>
                  </div>
                </div>

                <label className="block text-xs mb-4">
                  Motivo del registro manual
                  <input
                    value={manualNote}
                    onChange={(e) => setManualNote(e.target.value)}
                    maxLength={500}
                    className="block w-full border border-slate-200 rounded-lg p-2"
                    placeholder="Ej.: estudiante sin teléfono"
                  />
                </label>
                {/* Lista de Presentes y Ausentes */}
                <div className="text-xs mb-2 flex items-center justify-between">
                  <span className="font-bold text-slate-600">Lista de la sesión</span>
                  <input
                    type="text"
                    maxLength={80}
                    aria-label="Filtrar estudiantes por nombre"
                    placeholder="Filtrar por nombre..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value.toLowerCase())}
                    className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-slate-700 text-[11px]"
                  />
                </div>

                <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1 text-xs">
                  {/* Presentes */}
                  {sessionDetail.presents
                    .filter((p) => p.fullName.toLowerCase().includes(searchFilter))
                    .map((p) => (
                      <div
                        key={p.attendanceId}
                        className="p-2 bg-emerald-50 border border-emerald-500/20 rounded-xl flex items-center justify-between"
                      >
                        <div>
                          <p className="font-bold text-emerald-800">{p.fullName}</p>
                          <p className="text-[10px] text-slate-500 font-mono">{p.document}</p>
                        </div>
                        <span className="text-[10px] font-mono text-emerald-700">
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
                        className="p-2 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between"
                      >
                        <div>
                          <p className="font-medium text-slate-600">{a.fullName}</p>
                          <p className="text-[10px] text-slate-500 font-mono">{a.document}</p>
                        </div>
                        <button
                          disabled={manualSubmitting || sessionDetail.session.status !== "ABIERTA"}
                          onClick={() => handleManualAttendance(a.document)}
                          className="px-2 py-1 bg-slate-100 hover:bg-teal-700 hover:text-white rounded text-[10px] text-slate-600  transition-colors"
                        >
                          + Presente
                        </button>
                      </div>
                    ))}
                </div>
              </div>

              <button
                className="text-xs text-teal-700 underline mt-4"
                aria-expanded={showAudit}
                onClick={() => setShowAudit(!showAudit)}
              >
                {showAudit ? "Ocultar historial" : "Ver historial de cambios"}
              </button>
              {showAudit && <AuditTrail sessionId={sessionDetail.session.id} />}
              <div className="pt-3 border-t border-slate-200 mt-4 text-right">
                <button
                  onClick={() => openSessionDetail(sessionDetail.session.id)}
                  className="text-xs text-teal-700 hover:underline flex items-center gap-1 ml-auto"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Actualizar lista y renovar QR</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
