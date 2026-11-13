import type { StaffContext } from "./auth";
import { cleanString, isValidDateString } from "./validation";
import { normalizeDocument, normalizeGroupText } from "./utils";
import { cursorFilter, type Cursor } from "./pagination";
export interface ReportFilters {
  dateFrom: string;
  dateTo: string;
  groupName: string;
  subject: string;
  document: string;
}
export function parseReportFilters(params: URLSearchParams): ReportFilters {
  const filters = {
    dateFrom: cleanString(params.get("dateFrom"), 10),
    dateTo: cleanString(params.get("dateTo"), 10),
    groupName: normalizeGroupText(cleanString(params.get("groupName"), 20)),
    subject: cleanString(params.get("subject"), 120),
    document: normalizeDocument(cleanString(params.get("document"), 40)),
  };
  if (
    (filters.dateFrom && !isValidDateString(filters.dateFrom)) ||
    (filters.dateTo && !isValidDateString(filters.dateTo)) ||
    (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo)
  )
    throw new Error("INVALID_FILTERS");
  return filters;
}
export interface RawReport {
  id: string;
  registered_at: string;
  status: string;
  method: string;
  roster: { document: string; full_name: string; grade: string; group_name: string };
  session: { code: string; subject: string; group_name: string; date: string };
}
export function reportQuery(
  client: StaffContext["supabase"],
  filters: ReportFilters,
  cursor: Cursor | null,
  head = false,
  asOf?: string,
) {
  let query = client
    .from("attendances")
    .select(
      "id,registered_at,status,method,roster:session_roster!attendances_roster_fkey!inner(document,document_normalized,full_name,grade,group_name),session:sessions!inner(code,subject,group_name,date)",
      { count: head ? "exact" : undefined, head },
    )
    .order("registered_at", { ascending: false })
    .order("id", { ascending: false });
  if (filters.dateFrom) query = query.gte("session.date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("session.date", filters.dateTo);
  if (filters.groupName) query = query.eq("session.group_name", filters.groupName);
  if (filters.subject)
    query = query.ilike("session.subject", `%${filters.subject.replace(/[\\%_]/g, "\\$&")}%`);
  if (filters.document) query = query.ilike("roster.document_normalized", filters.document);
  if (cursor) query = query.or(cursorFilter("registered_at", cursor));
  if (asOf) query = query.lte("registered_at", asOf);
  return query;
}
export function reportRow(item: RawReport) {
  return {
    id: item.id,
    sessionCode: item.session.code,
    subject: item.session.subject,
    sessionGroup: item.session.group_name,
    date: item.session.date,
    registeredAt: item.registered_at,
    document: item.roster.document,
    studentName: item.roster.full_name,
    grade: item.roster.grade,
    group: item.roster.group_name,
    status: item.status,
    method: item.method,
  };
}
