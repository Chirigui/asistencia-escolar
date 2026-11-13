"use client";
import type { Dispatch, SetStateAction } from "react";
import type { ImportPreview } from "@/types/teacher";
import { CheckCircle } from "lucide-react";
interface Props {
  importCsvText: string;
  setImportCsvText: Dispatch<SetStateAction<string>>;
  handleParseAndImport: (dryRun: boolean) => void;
  importing: boolean;
  importSuccessMsg: string;
  importPreview: ImportPreview | null;
}
export default function ImportPanel({
  importCsvText,
  setImportCsvText,
  handleParseAndImport,
  importing,
  importSuccessMsg,
  importPreview,
}: Props) {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Importador Masivo de Estudiantes</h2>
        <p className="text-xs text-slate-600">
          Pega directamente tus filas de Excel o CSV con las columnas: <br />
          <code className="text-teal-700 font-mono">
            Documento, Nombre Completo, Grado, Grupo, Estado
          </code>
        </p>
      </div>

      {importSuccessMsg && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-2xl text-xs flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-700" />
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
          placeholder={
            "1000000020,Estudiante Ejemplo Uno,10,10A,ACTIVO\n1000000021,Estudiante Ejemplo Dos,10,10A,ACTIVO"
          }
          className="w-full p-4 bg-white border border-slate-200 rounded-2xl font-mono text-xs text-slate-900 placeholder-slate-600 focus:outline-none focus:border-blue-500"
        />

        <div className="flex items-center gap-3">
          <button
            onClick={() => handleParseAndImport(true)}
            disabled={importing || !importCsvText.trim()}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-700 disabled:opacity-50 text-slate-900 rounded-xl text-xs font-semibold transition-colors"
          >
            Previsualizar y Validar
          </button>
          <button
            onClick={() => handleParseAndImport(false)}
            disabled={importing || !importCsvText.trim()}
            className="px-4 py-2.5 bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-50  rounded-xl text-xs font-semibold shadow-lg shadow-teal-900/10 transition-colors"
          >
            Importar a Base de Datos
          </button>
        </div>
      </div>

      {importPreview && (
        <div className="p-5 bg-white border border-slate-200 rounded-2xl space-y-4">
          <div className="grid grid-cols-4 gap-3 text-center text-xs">
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-slate-500">Filas Totales</p>
              <p className="text-lg font-bold text-slate-900 mt-1">{importPreview.summary.total}</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-slate-500">Válidas</p>
              <p className="text-lg font-bold text-emerald-700 mt-1">
                {importPreview.summary.valid}
              </p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-slate-500">Duplicados</p>
              <p className="text-lg font-bold text-amber-400 mt-1">
                {importPreview.summary.duplicates}
              </p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-slate-500">Inválidos</p>
              <p className="text-lg font-bold text-rose-400 mt-1">
                {importPreview.summary.invalid}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto max-h-60 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 sticky top-0">
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
                        <span className="text-emerald-700 font-bold">Válido</span>
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
  );
}
