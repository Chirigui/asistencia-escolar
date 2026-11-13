export interface SessionListItem {
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

export interface SessionDetailSession {
  id: string;
  code: string;
  subject: string;
  group_name: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
}

export interface PresentRow {
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

export interface AbsentRow {
  id: string;
  document: string;
  fullName: string;
  grade: string;
  groupName: string;
}

export interface SessionDetail {
  rosterReconstructed?: boolean;
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

export interface ReportRow {
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

export interface ImportPreviewRow {
  row: number;
  document: string;
  fullName: string;
  grade: string;
  groupName: string;
  status: string;
  valid: boolean;
  errors: string[];
}

export interface ImportPreview {
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
