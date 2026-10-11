export type Role = 'teacher' | 'admin';

export type StudentStatus = 'ACTIVO' | 'INACTIVO' | 'RETIRADO';

export type SessionStatus = 'ABIERTA' | 'CERRADA' | 'FINALIZADA';

export type AttendanceStatus = 'PRESENTE' | 'TARDE' | 'JUSTIFICADO';

export type AttendanceMethod = 'QR' | 'MANUAL' | 'ADMIN';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  created_at: string;
  updated_at: string;
}

export interface Student {
  id: string;
  document: string;
  document_normalized: string;
  full_name: string;
  grade: string;
  group_name: string;
  status: StudentStatus;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  code: string;
  teacher_id: string | null;
  subject: string;
  group_name: string;
  date: string;
  start_time: string;
  end_time: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
}

export interface Attendance {
  id: string;
  session_id: string;
  student_id: string;
  registered_at: string;
  status: AttendanceStatus;
  method: AttendanceMethod;
  notes: string | null;
  created_at: string;
  student?: Student;
}

export interface Incident {
  id: string;
  session_id: string | null;
  student_id: string | null;
  document_attempted: string | null;
  incident_type: string;
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}
