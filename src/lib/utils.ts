import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

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
