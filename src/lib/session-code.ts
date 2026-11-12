import { randomBytes } from "node:crypto";

// Alfabeto sin caracteres ambiguos (0/O, 1/I) para leer el código desde el QR.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Genera un código de sesión no secuencial, por ejemplo `SK7M2Q`.
 *
 * Los códigos secuenciales permitían enumerar todas las sesiones abiertas y
 * atacar el endpoint público de registro probando S001, S002, etc.
 */
export function generateSessionCode(length = 6): string {
  const bytes = randomBytes(length);
  let code = "S";
  for (let i = 0; i < length; i += 1) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}
