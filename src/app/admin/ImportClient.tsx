"use client";

import { useMemo, useState, useTransition } from "react";

type ImportClientProps = {
  defaultUrl: string;
  analyzeAction: (fd: FormData) => Promise<void>;
};

export default function ImportClient({ defaultUrl, analyzeAction }: ImportClientProps) {
  const [url, setUrl] = useState(defaultUrl || "");
  const [file, setFile] = useState<File | null>(null);

  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [status, setStatus] = useState<string>("");

  const [isPending, startTransition] = useTransition();
  const canRun = useMemo(() => !!url || !!file, [url, file]);

  async function runOcrOnClient(selected: File) {
    setStatus("OCR gratuit en cours… (10–40s selon la capture)");
    setOcrProgress(0);

    const Tesseract = (await import("tesseract.js")).default;

    const result = await Tesseract.recognize(selected, "fra", {
      logger: (m: any) => {
        if (m?.progress != null) setOcrProgress(Math.round(m.progress * 100));
        if (m?.status) {
          const pct = m?.progress != null ? ` (${Math.round(m.progress * 100)}%)` : "";
          setStatus(`OCR: ${m.status}${pct}`);
        }
      },
    });

    return (result?.data?.text ?? "").trim();
  }

  async function onSubmit() {
    if (!canRun || isPending) return;

    try {
      let ocrText = "";

      if (file) {
        ocrText = await runOcrOnClient(file);
        if (!ocrText) setStatus("OCR terminé mais aucun texte détecté. Essaie une capture plus nette.");
        else setStatus("OCR terminé ✅ Envoi au serveur…");
      } else {
        setStatus("Envoi au serveur…");
      }

      const fd = new FormData();
      if (url) fd.set("source_url", url);
      if (ocrText) fd.set("ocr_text", ocrText);

      startTransition(async () => {
        await analyzeAction(fd); // redirect /admin
      });
    } catch (e: any) {
      setStatus(`⚠️ Erreur: ${e?.message ?? "erreur inconnue"}`);
    }
  }

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.06)",
        backdropFilter: "blur(10px)",
        borderRadius: 22,
        padding: 14,
      }}
    >
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 800, color: "white" }}>Importer (URL / capture)</div>
          <span
            style={{
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.85)",
            }}
          >
            Safe mode : pas de publication automatique
          </span>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {/* Ligne URL + bouton orange */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Colle l’URL ici…"
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.14)",
                outline: "none",
                background: "rgba(255,255,255,0.92)",
                color: "#0b1220",
              }}
            />

            <button
              type="button"
              onClick={onSubmit}
              disabled={!canRun || isPending}
              style={{
                borderRadius: 16,
                padding: "12px 18px",
                border: "1px solid rgba(249,115,22,0.35)",
                background: isPending
                  ? "rgba(249,115,22,0.25)"
                  : "linear-gradient(135deg,#f97316,#fb923c)",
                color: "#fff",
                cursor: !canRun || isPending ? "not-allowed" : "pointer",
                fontWeight: 800,
                boxShadow: "0 18px 32px rgba(249,115,22,0.18)",
                whiteSpace: "nowrap",
              }}
            >
              {isPending ? "Analyse…" : "Rechercher"}
            </button>
          </div>

          {/* Upload */}
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.78)" }}>
              Ou ajoute une capture (OCR gratuit)
            </div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              style={{ width: "100%", color: "rgba(255,255,255,0.85)" }}
            />
          </div>
        </div>

        {status ? (
          <div style={{ marginTop: 4, fontSize: 13, color: "rgba(255,255,255,0.88)" }}>
            <div>{status}</div>
            {file ? (
              <div style={{ marginTop: 6, color: "rgba(255,255,255,0.78)" }}>
                Progression OCR : <b>{ocrProgress}%</b>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
