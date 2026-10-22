import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const SCHOOL_TIME_ZONE = "America/Bogota";

export function getSchoolDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHOOL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Normaliza el documento de identidad de un estudiante:
 * Remueve espacios en blanco, guiones, puntos y símbolos especiales.
 */
export function normalizeDocument(doc: string | number): string {
  return String(doc || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9]/g, "");
}

/**
 * Normaliza nombres de grados y grupos para comparación tolerante.
 * Ej: " 10-A " -> "10A"
 */
export function normalizeGroupText(group: string): string {
  return String(group || "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-_]/g, "");
}
