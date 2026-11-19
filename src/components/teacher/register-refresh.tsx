"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function RegisterRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  return (
    <button className="rounded border px-3" onClick={() => router.refresh()}>
      Actualizar
    </button>
  );
}
