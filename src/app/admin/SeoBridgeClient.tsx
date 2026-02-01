"use client";

import { useEffect } from "react";

type Props = {
  // nom du textarea dans le formulaire (ici "description")
  targetTextareaName: string;
};

export default function SeoBridgeClient({ targetTextareaName }: Props) {
  useEffect(() => {
    function handler(ev: Event) {
      // ✅ safe guard
      const ce = ev as CustomEvent | null;
      const text = ce && "detail" in ce ? (ce as any).detail?.optimizedDescription : null;

      if (typeof text !== "string" || !text.trim()) return;

      const el = document.querySelector(
        `textarea[name="${CSS.escape(targetTextareaName)}"]`
      ) as HTMLTextAreaElement | null;

      if (!el) return;

      el.value = text;

      // Déclenche les listeners éventuels (validation/dirty state)
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));

      // Scroll léger vers la description (utile mobile)
      try {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus();
      } catch {}
    }

    window.addEventListener("admin-maisonlouer:seo-optimized", handler as EventListener);
    return () => window.removeEventListener("admin-maisonlouer:seo-optimized", handler as EventListener);
  }, [targetTextareaName]);

  return null;
}
