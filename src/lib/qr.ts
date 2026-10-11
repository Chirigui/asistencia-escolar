import QRCode from "qrcode";

/**
 * Genera un código QR nativo como Data URL (PNG en Base64).
 * No depende de ninguna API ni servicio de terceros, brindando máxima privacidad,
 * cero latencia y funcionamiento sin conexión a servicios externos.
 */
export async function generateQrDataUrl(text: string): Promise<string> {
  try {
    return await QRCode.toDataURL(text, {
      errorCorrectionLevel: "H",
      margin: 2,
      width: 450,
      color: {
        dark: "#0f172a",
        light: "#ffffff",
      },
    });
  } catch (err) {
    console.error("Error generando código QR nativo:", err);
    throw new Error("No se pudo generar el código QR.");
  }
}
