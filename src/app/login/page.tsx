/* =========================================================
   File: src/app/login/page.tsx
   Login MaisonLouer Admin — Premium + Mobile Friendly
========================================================= */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

import { supabaseBrowser } from "../../lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string>("");
  const [info, setInfo] = useState<string>("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }

      setInfo("Connexion réussie ✅ Redirection…");
      router.push("/admin");
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Erreur inconnue");
      setLoading(false);
    }
  }

  async function onResetPassword() {
    setError("");
    setInfo("");

    if (!email.trim()) {
      setError("Entre ton email pour recevoir le lien de réinitialisation.");
      return;
    }

    setLoading(true);
    try {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/login`
          : undefined;

      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      setInfo("📩 Email envoyé. Vérifie ta boîte de réception.");
      setLoading(false);
    } catch (err: any) {
      setError(err?.message ?? "Erreur inconnue");
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(1100px 700px at 20% 10%, rgba(249,115,22,0.10), transparent 55%)," +
          "radial-gradient(1100px 700px at 80% 0%, rgba(255,255,255,0.06), transparent 60%)," +
          "linear-gradient(180deg, #0a2340, #071a2d)",
        display: "grid",
        placeItems: "center",
        padding: "18px 14px",
        color: "white",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 980,
          display: "grid",
          gap: 16,
          gridTemplateColumns: "1.05fr 0.95fr",
        }}
      >
        {/* LEFT - Branding */}
        <section
          style={{
            borderRadius: 26,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.06)",
            backdropFilter: "blur(10px)",
            boxShadow: "0 18px 45px rgba(2,8,23,0.25)",
            padding: 22,
            display: "grid",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Image
              src="/logo.png"
              alt="MaisonLouer"
              width={56}
              height={56}
              style={{
                borderRadius: 14,
                background: "white",
                padding: 6,
              }}
            />

            <div>
              <div style={{ fontSize: 14, opacity: 0.75 }}>MaisonLouer</div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>
                Espace Admin
              </div>
            </div>
          </div>

          <div>
            <h1
              style={{
                fontSize: 40,
                lineHeight: 1.1,
                fontWeight: 950,
                letterSpacing: "-0.03em",
                margin: "12px 0",
              }}
            >
              Gère tes annonces
              <br />
              en toute simplicité
            </h1>

            <p style={{ opacity: 0.8, lineHeight: 1.6 }}>
              Import automatique depuis URL ou image, brouillons sécurisés,
              publication contrôlée.
              <br />
              <b>Aligné avec l’expérience MaisonLouer.</b>
            </p>
          </div>

          <ul style={{ fontSize: 14, opacity: 0.85, paddingLeft: 18 }}>
            <li>🔒 Aucun contenu publié sans validation</li>
            <li>⚡ OCR & parsing gratuit</li>
            <li>📱 Optimisé mobile & desktop</li>
          </ul>
        </section>

        {/* RIGHT - Login */}
        <section
          style={{
            borderRadius: 26,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.06)",
            backdropFilter: "blur(10px)",
            boxShadow: "0 18px 45px rgba(2,8,23,0.25)",
            padding: 18,
          }}
        >
          <div
            style={{
              background: "white",
              color: "#0b1220",
              borderRadius: 22,
              padding: 20,
            }}
          >
            <h2 style={{ fontWeight: 900, marginBottom: 6 }}>Connexion</h2>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 14 }}>
              Accède à ton espace administrateur.
            </p>

            {error && (
              <div
                style={{
                  background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.35)",
                  color: "#7f1d1d",
                  padding: 10,
                  borderRadius: 12,
                  marginBottom: 10,
                  fontSize: 13,
                }}
              >
                ⚠️ {error}
              </div>
            )}

            {info && (
              <div
                style={{
                  background: "rgba(34,197,94,0.1)",
                  border: "1px solid rgba(34,197,94,0.35)",
                  color: "#14532d",
                  padding: 10,
                  borderRadius: 12,
                  marginBottom: 10,
                  fontSize: 13,
                }}
              >
                ✅ {info}
              </div>
            )}

            <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                style={{
                  padding: "12px 14px",
                  borderRadius: 14,
                  border: "1px solid #e5e7eb",
                }}
              />

              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type={showPwd ? "text" : "password"}
                  placeholder="Mot de passe"
                  style={{
                    flex: 1,
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid #e5e7eb",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  style={{
                    padding: "12px",
                    borderRadius: 14,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    fontWeight: 700,
                  }}
                >
                  {showPwd ? "🙈" : "👁️"}
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  padding: "12px",
                  borderRadius: 14,
                  border: "none",
                  background: "linear-gradient(135deg,#f97316,#fb923c)",
                  color: "white",
                  fontWeight: 900,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                {loading ? "Connexion…" : "Se connecter"}
              </button>

              <button
                type="button"
                onClick={onResetPassword}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#f97316",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Mot de passe oublié
              </button>
            </form>
          </div>
        </section>
      </div>

      {/* Mobile */}
      <style>{`
        @media (max-width: 900px) {
          main > div {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  );
}
