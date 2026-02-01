"use client";

import { useMemo, useState, useTransition } from "react";

type SeoOptimizeResult = {
  score: number; // 0-100
  optimizedDescription: string;
  keywords: string[];
  improvements: string[];
};

type TypeOffre = "Louer" | "Vendre";

type ImportClientProps = {
  defaultUrl: string;
  analyzeAction: (fd: FormData) => Promise<void>;

  /**
   * ✅ Optionnel : Server Action qui appelle Gemini et renvoie l'optimisation SEO.
   * On la branchera ensuite depuis src/app/admin/page.tsx (ou le parent).
   */
  optimizeSeoAction?: (fd: FormData) => Promise<SeoOptimizeResult>;

  /**
   * ✅ Optionnel : callback pour "appliquer" la description optimisée dans le formulaire parent.
   * Si non fourni : on propose Copier + dispatch d'un CustomEvent.
   */
  onApplyOptimizedDescription?: (text: string) => void;
};

export default function ImportClient({
  defaultUrl,
  analyzeAction,
  optimizeSeoAction,
  onApplyOptimizedDescription,
}: ImportClientProps) {
  const [url, setUrl] = useState(defaultUrl || "");
  const [file, setFile] = useState<File | null>(null);

  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [status, setStatus] = useState<string>("");

  const [isPending, startTransition] = useTransition();
  const canRun = useMemo(() => !!url || !!file, [url, file]);

  // ----------------------------
  // ✅ SEO Optimizer (UI only)
  // ----------------------------
  const [descInput, setDescInput] = useState<string>("");
  const [seoTypeOffre, setSeoTypeOffre] = useState<TypeOffre>("Louer"); // ✅ NEW
  const [seoPending, setSeoPending] = useState<boolean>(false);
  const [seoError, setSeoError] = useState<string>("");
  const [seoResult, setSeoResult] = useState<SeoOptimizeResult | null>(null);

  const canSeo = useMemo(() => descInput.trim().length >= 40 && !!optimizeSeoAction && !seoPending, [
    descInput,
    optimizeSeoAction,
    seoPending,
  ]);

  function scoreLabel(score: number) {
    if (score >= 85) return "Excellent";
    if (score >= 70) return "Bon";
    if (score >= 50) return "Moyen";
    return "À améliorer";
  }

  function scoreBadgeBg(score: number) {
    if (score >= 85) return "rgba(16,185,129,0.18)"; // vert
    if (score >= 70) return "rgba(59,130,246,0.18)"; // bleu
    if (score >= 50) return "rgba(245,158,11,0.18)"; // orange
    return "rgba(239,68,68,0.18)"; // rouge
  }

  const seoHint = seoTypeOffre === "Louer" ? "maison à louer" : "maison à vendre";

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

  async function onOptimizeSeo() {
    if (!optimizeSeoAction) {
      setSeoError("⚠️ optimizeSeoAction n’est pas branchée côté serveur.");
      return;
    }
    const text = descInput.trim();
    if (text.length < 40) {
      setSeoError("Ajoute une description un peu plus longue (au moins ~40 caractères).");
      return;
    }

    setSeoError("");
    setSeoResult(null);
    setSeoPending(true);

    try {
      const fd = new FormData();
      fd.set("description", text);

      // ✅ Contexte constant
      fd.set("city", "Antananarivo");
      fd.set("country", "Madagascar");
      fd.set("market", "immobilier");

      // ✅ NEW: typeoffre (verrou louer/vendre côté serveur)
      fd.set("typeoffre", seoTypeOffre);

      // ❌ IMPORTANT: on ne met plus "intent = louer ou vendre"
      // Le serveur calcule intent uniquement depuis typeoffre

      const res = await optimizeSeoAction(fd);
      setSeoResult({
        score: Math.max(0, Math.min(100, Math.round(res.score))),
        optimizedDescription: (res.optimizedDescription ?? "").trim(),
        keywords: Array.isArray(res.keywords) ? res.keywords.filter(Boolean) : [],
        improvements: Array.isArray(res.improvements) ? res.improvements.filter(Boolean) : [],
      });
    } catch (e: any) {
      setSeoError(e?.message ?? "Erreur inconnue côté optimisation SEO.");
    } finally {
      setSeoPending(false);
    }
  }

  async function onCopyOptimized() {
    const text = seoResult?.optimizedDescription?.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setSeoError("");
      setStatus("✅ Description optimisée copiée dans le presse-papiers.");
    } catch {
      setStatus("⚠️ Impossible de copier automatiquement. Copie manuellement le texte.");
    }
  }

  function onApplyOptimized() {
    const text = seoResult?.optimizedDescription?.trim();
    if (!text) return;

    // 1) Si le parent fournit un setter, on l’utilise.
    if (onApplyOptimizedDescription) {
      onApplyOptimizedDescription(text);
      setStatus("✅ Description optimisée appliquée au formulaire.");
      return;
    }

    // 2) Sinon, on émet un événement global (le parent peut écouter).
    window.dispatchEvent(
      new CustomEvent("admin-maisonlouer:seo-optimized", {
        detail: { optimizedDescription: text },
      })
    );

    setStatus("✅ Description optimisée prête. (Événement envoyé + tu peux aussi Copier)");
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
      <div style={{ display: "grid", gap: 14 }}>
        {/* Header */}
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

        {/* Import block */}
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
                background: isPending ? "rgba(249,115,22,0.25)" : "linear-gradient(135deg,#f97316,#fb923c)",
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
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.78)" }}>Ou ajoute une capture (OCR gratuit)</div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              style={{ width: "100%", color: "rgba(255,255,255,0.85)" }}
            />
          </div>
        </div>

        {/* Status */}
        {status ? (
          <div style={{ marginTop: 2, fontSize: 13, color: "rgba(255,255,255,0.88)" }}>
            <div>{status}</div>
            {file ? (
              <div style={{ marginTop: 6, color: "rgba(255,255,255,0.78)" }}>
                Progression OCR : <b>{ocrProgress}%</b>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ----------------------------------------
            ✅ SEO optimizer block (Gemini)
        ---------------------------------------- */}
        <div
          style={{
            marginTop: 6,
            borderRadius: 22,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(10, 18, 32, 0.25)",
            padding: 14,
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 900, color: "white" }}>Optimiser la description (SEO Antananarivo)</div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {/* ✅ NEW: Type offre */}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.72)" }}>Type d’offre</span>
                  <select
                    value={seoTypeOffre}
                    onChange={(e) => setSeoTypeOffre((e.target.value as TypeOffre) ?? "Louer")}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 14,
                      border: "1px solid rgba(255,255,255,0.16)",
                      background: "rgba(255,255,255,0.10)",
                      color: "rgba(255,255,255,0.92)",
                      outline: "none",
                      fontWeight: 800,
                    }}
                  >
                    <option value="Louer">Louer</option>
                    <option value="Vendre">Vendre</option>
                  </select>
                </div>

                <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.72)" }}>
                  Mots-clés & structure adaptés à <b>{seoHint}</b> — Antananarivo, Madagascar.
                </div>
              </div>
            </div>

            <span
              style={{
                fontSize: 12,
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.14)",
                background: optimizeSeoAction ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.10)",
                color: "rgba(255,255,255,0.88)",
                whiteSpace: "nowrap",
              }}
              title={optimizeSeoAction ? "Action serveur branchée" : "On branchera l'action serveur Gemini ensuite"}
            >
              {optimizeSeoAction ? "Gemini prêt ✅" : "Gemini non branché (étape suivante)"}
            </span>
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <textarea
              value={descInput}
              onChange={(e) => setDescInput(e.target.value)}
              placeholder="Colle ta description actuelle ici… (quartier, surface, nb chambres, jardin, parking, prix, contact)"
              rows={5}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.14)",
                outline: "none",
                background: "rgba(255,255,255,0.92)",
                color: "#0b1220",
                resize: "vertical",
              }}
            />

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                onClick={onOptimizeSeo}
                disabled={!canSeo}
                style={{
                  borderRadius: 16,
                  padding: "12px 16px",
                  border: "1px solid rgba(99,102,241,0.40)",
                  background: !canSeo ? "rgba(99,102,241,0.18)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
                  color: "#fff",
                  cursor: !canSeo ? "not-allowed" : "pointer",
                  fontWeight: 900,
                  boxShadow: "0 18px 32px rgba(139,92,246,0.18)",
                  whiteSpace: "nowrap",
                }}
                title={!optimizeSeoAction ? "On va brancher Gemini dans actions.ts ensuite" : "Optimiser via Gemini"}
              >
                {seoPending ? "Optimisation…" : `Optimiser SEO (${seoHint})`}
              </button>

              <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.72)" }}>
                Conseil: mentionne <b>quartier</b>, <b>surface</b>, <b>pièces</b>, <b>proximité</b>, <b>prix</b>, <b>contact</b>.
              </div>
            </div>

            {seoError ? (
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.92)" }}>
                <span style={{ color: "#fb7185", fontWeight: 800 }}>⚠️</span> {seoError}
              </div>
            ) : null}

            {seoResult ? (
              <div style={{ display: "grid", gap: 12 }}>
                {/* Score */}
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: 12,
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.14)",
                      background: scoreBadgeBg(seoResult.score),
                      color: "rgba(255,255,255,0.92)",
                      fontWeight: 900,
                    }}
                  >
                    Score SEO : {seoResult.score}/100 — {scoreLabel(seoResult.score)}
                  </span>

                  <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.72)" }}>
                    Cible: <b>{seoHint}</b> à Antananarivo.
                  </span>
                </div>

                {/* Keywords */}
                {seoResult.keywords?.length ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontWeight: 800, color: "rgba(255,255,255,0.92)" }}>Mots-clés suggérés</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {seoResult.keywords.slice(0, 18).map((k, idx) => (
                        <span
                          key={`${k}-${idx}`}
                          style={{
                            fontSize: 12,
                            padding: "6px 10px",
                            borderRadius: 999,
                            border: "1px solid rgba(255,255,255,0.14)",
                            background: "rgba(255,255,255,0.08)",
                            color: "rgba(255,255,255,0.88)",
                          }}
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Improvements */}
                {seoResult.improvements?.length ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontWeight: 800, color: "rgba(255,255,255,0.92)" }}>Améliorations proposées</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {seoResult.improvements.slice(0, 10).map((imp, idx) => (
                        <div
                          key={`${idx}`}
                          style={{
                            fontSize: 13,
                            color: "rgba(255,255,255,0.86)",
                            padding: "10px 12px",
                            borderRadius: 14,
                            border: "1px solid rgba(255,255,255,0.10)",
                            background: "rgba(255,255,255,0.06)",
                          }}
                        >
                          • {imp}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Optimized description */}
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontWeight: 900, color: "white" }}>Description optimisée</div>
                  <textarea
                    value={seoResult.optimizedDescription}
                    readOnly
                    rows={6}
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      borderRadius: 16,
                      border: "1px solid rgba(255,255,255,0.14)",
                      outline: "none",
                      background: "rgba(255,255,255,0.92)",
                      color: "#0b1220",
                      resize: "vertical",
                    }}
                  />

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={onApplyOptimized}
                      disabled={!seoResult.optimizedDescription?.trim()}
                      style={{
                        borderRadius: 16,
                        padding: "12px 16px",
                        border: "1px solid rgba(34,197,94,0.35)",
                        background: "linear-gradient(135deg,#22c55e,#16a34a)",
                        color: "#fff",
                        cursor: "pointer",
                        fontWeight: 900,
                        boxShadow: "0 18px 32px rgba(34,197,94,0.16)",
                        whiteSpace: "nowrap",
                      }}
                      title={
                        onApplyOptimizedDescription
                          ? "Appliquer dans le formulaire"
                          : "Appliquer via CustomEvent (le parent peut écouter)"
                      }
                    >
                      Appliquer
                    </button>

                    <button
                      type="button"
                      onClick={onCopyOptimized}
                      disabled={!seoResult.optimizedDescription?.trim()}
                      style={{
                        borderRadius: 16,
                        padding: "12px 16px",
                        border: "1px solid rgba(255,255,255,0.18)",
                        background: "rgba(255,255,255,0.10)",
                        color: "rgba(255,255,255,0.92)",
                        cursor: "pointer",
                        fontWeight: 900,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Copier
                    </button>

                    <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.72)", alignSelf: "center" }}>
                      Tip: “Appliquer” remplace la description du formulaire (quand on le branche).
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
