export interface AcademicData {
  role: "teacher" | "admin";
  email?: string;
  groups: Array<{ id: string; name: string }>;
  periods: Array<{ id: string; name: string; starts_on: string; ends_on: string; active: boolean }>;
  assignments: Array<{
    id: string;
    teacher_id: string;
    period_id: string;
    group: { id: string; name: string };
  }>;
  teachers: Array<{ id: string; full_name: string; email: string }>;
}
