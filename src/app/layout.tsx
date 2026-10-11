import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sistema de Asistencia Escolar QR",
  description: "Plataforma moderna y segura de control de asistencia escolar en tiempo real",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased bg-slate-950 text-slate-100">
        {children}
      </body>
    </html>
  );
}
