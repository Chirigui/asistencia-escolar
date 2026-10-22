import { z } from "zod";

const nonEmpty = z.string().trim().min(1);
const attendanceStatus = z.enum(["PRESENTE", "TARDE", "JUSTIFICADO"]);

export const manualAttendanceSchema = z.object({
  sessionId: z.string().uuid(),
  document: nonEmpty.max(64),
  status: attendanceStatus.default("PRESENTE"),
  notes: z.string().trim().max(1000).optional(),
}).strict();

export const attendanceUpdateSchema = z.object({
  status: attendanceStatus,
  notes: z.string().trim().max(1000).nullable().optional(),
}).strict();

export const registerAttendanceSchema = z.object({
  sessionCode: z.string().trim().min(6).max(8).regex(/^[A-Z0-9]+$/i),
  document: nonEmpty.max(64),
}).strict();

export const sessionCreateSchema = z.object({
  subject: nonEmpty.max(120),
  groupName: nonEmpty.max(40),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
}).strict();

export const sessionUpdateSchema = z.object({
  status: z.enum(["ABIERTA", "CERRADA", "FINALIZADA"]),
}).strict();

export const studentImportSchema = z.object({
  dryRun: z.boolean().default(false),
  rows: z.array(z.object({
    document: z.string().max(64).optional(),
    fullName: z.string().max(200).optional(),
    grade: z.string().max(40).optional(),
    groupName: z.string().max(40).optional(),
    status: z.string().max(20).optional(),
  }).strict()).min(1).max(5000),
}).strict();

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<
  { success: true; data: T } | { success: false }
> {
  try {
    const parsed = schema.safeParse(await request.json());
    return parsed.success ? { success: true, data: parsed.data } : { success: false };
  } catch {
    return { success: false };
  }
}
