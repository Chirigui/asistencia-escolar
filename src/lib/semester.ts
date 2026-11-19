import { isUuid } from "./validation";
import type { StaffContext } from "./auth";

export const markNames: Record<string, string> = {
  PRESENTE: "Presente",
  TARDE: "Tarde",
  AUSENTE: "Ausente",
  JUSTIFICADO: "Justificada",
};
export interface SemesterRegister {
  groupName: string;
  historical: boolean;
  classes: { id: string; subject: string; date: string; time: string; code: string }[];
  students: {
    id: string;
    name: string;
    total: number;
    attended: number;
    absent: number;
    excused: number;
    marks: Record<string, string>;
  }[];
}
export function validTerm(term: string) {
  return /^(19\d{2}|20\d{2}|21\d{2}|2200)-[12]$/.test(term);
}
export async function readRegister(
  ctx: StaffContext,
  group: string,
  term: string,
): Promise<SemesterRegister | null> {
  if (ctx.role !== "admin" || !isUuid(group) || !validTerm(term)) return null;
  const [year, half] = term.split("-").map(Number);
  const { data, error } = await ctx.supabase.rpc("semester_register", {
    p_group: group,
    p_year: year,
    p_half: half,
  });
  if (error) throw new Error("No fue posible consultar la lista semestral.");
  return data;
}
export function termLabel(term: string) {
  const [year, half] = term.split("-");
  return (half === "1" ? "Primer" : "Segundo") + " semestre de " + year;
}
