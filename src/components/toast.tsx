"use client";
import { useEffect, useState } from "react";

type Toast = { id: number; message: string; variant: "info" | "success" | "error" };

let counter = 0;

export function toast(message: string, variant: "info" | "success" | "error" = "info") {
  window.dispatchEvent(new CustomEvent("localmind-toast", { detail: { message, variant } }));
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    function onToast(e: Event) {
      const { message, variant } = (e as CustomEvent).detail;
      const id = ++counter;
      setToasts((t) => [...t, { id, message, variant }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
    }
    window.addEventListener("localmind-toast", onToast);
    return () => window.removeEventListener("localmind-toast", onToast);
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rounded-md border px-3 py-2 text-sm shadow-lg max-w-sm ${
            t.variant === "error"
              ? "bg-destructive text-destructive-foreground border-destructive"
              : t.variant === "success"
              ? "bg-green-600 text-white border-green-600"
              : "bg-card"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
