import type { Metadata } from "next";
import "./globals.css";
import { school } from "@/lib/school";
import type { CSSProperties } from "react";

export const metadata: Metadata = {
  title: `Asistencia escolar · ${school.name}`,
  description: "Plataforma moderna y segura de control de asistencia escolar en tiempo real",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" style={{ "--school-color": school.color } as CSSProperties}>
      <body className="min-h-screen antialiased bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
