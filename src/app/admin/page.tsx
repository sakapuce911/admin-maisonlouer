/* =========================================================
   File: src/app/admin/page.tsx
   Admin MaisonLouer — MOBILE FRIENDLY
========================================================= */

import "./admin.css";

import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { supabaseServer } from "../../lib/supabase/server";

import ImportClient from "./ImportClient";
import SeoBridgeClient from "./SeoBridgeClient";

import {
  analyzeSourceAction,
  clearDraftAction,
  createAnnonceAction,
  deleteAnnonceAction,
  saveDraftAnnonceAction,
  signOutAction,
  type DraftAnnonce,
  optimizeSeoDescriptionAction, // ✅ NEW
} from "./actions";

function safeJsonParse<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export default async function AdminPage() {
  const supabase = await supabaseServer();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;

  const jar = await cookies();
  const draft = safeJsonParse<DraftAnnonce>(jar.get("ml_draft_annonce")?.value ?? null);

  const { data: annonces } = await supabase
    .from("annonces")
    .select("id, titre, ville, quartier, prixar, typeoffre, publie, created_at")
    .order("created_at", { ascending: false });

  return (
    <main className="ml-admin">
      <div className="ml-container">
        {/* TOPBAR */}
        <header className="ml-topbar">
          <div className="ml-brand">
            {/* ✅ Logo cliquable vers le site public */}
            <Link
              href="https://maisonlouer.vercel.app/"
              target="_blank"
              rel="noreferrer"
              aria-label="Aller au site public MaisonLouer"
              style={{ display: "inline-flex" }}
            >
              <div className="ml-logo">
                <Image
                  src="/logo.png"
                  alt="MaisonLouer"
                  width={36}
                  height={36}
                  style={{
                    objectFit: "contain",
                    background: "white",
                    borderRadius: 10,
                    padding: 4,
                  }}
                  priority
                />
              </div>
            </Link>

            <div className="ml-title">
              <h1>Admin MaisonLouer</h1>
              <p>Importer (URL / capture) • Brouillon • Publication manuelle</p>
            </div>
          </div>

          <div className="ml-actions">
            {/* ✅ petit lien harmonisé */}
            <Link className="ml-site-link" href="https://maisonlouer.vercel.app/" target="_blank" rel="noreferrer">
              Voir le site
            </Link>

            <span className="ml-pill">
              {user ? (
                <>
                  Connecté : <b>{user.email}</b>
                </>
              ) : (
                <>
                  Statut : <b>Non connecté</b>
                </>
              )}
            </span>

            <form action={signOutAction}>
              <button className="ml-btn ml-btn-ghost" type="submit">
                Se déconnecter
              </button>
            </form>
          </div>
        </header>

        <div className="ml-grid-2">
          {/* LEFT */}
          <div className="ml-card">
            <h2>Importer une annonce</h2>
            <p>
              Colle une URL ou ajoute une capture. L’OCR est fait <b>sur ton navigateur</b> (gratuit), puis on prépare un{" "}
              <b>brouillon</b> et on préremplit le formulaire.
            </p>

            {/* ✅ On passe aussi l'action Gemini (SEO) */}
            <ImportClient
              defaultUrl={draft?.source_url ?? ""}
              analyzeAction={analyzeSourceAction}
              optimizeSeoAction={optimizeSeoDescriptionAction}
            />

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
              <form action={clearDraftAction}>
                <button className="ml-btn" type="submit">
                  Effacer le brouillon
                </button>
              </form>

              {draft ? (
                <span className="ml-badge ml-badge-warn">⏳ Brouillon en cours</span>
              ) : (
                <span className="ml-badge">Aucun brouillon</span>
              )}
            </div>

            {draft?.source_url ? (
              <div className="ml-footer-note" style={{ wordBreak: "break-word" }}>
                <b>URL :</b> {draft.source_url}
              </div>
            ) : null}

            <div className="ml-divider" />

            <h2>Créer une annonce</h2>
            <p>Vérifie et ajuste la reformulation avant d’enregistrer.</p>

            {/* ✅ Pont client : écoute "Appliquer" depuis ImportClient et remplit la description */}
            <SeoBridgeClient targetTextareaName="description" />

            <form action={createAnnonceAction} className="ml-form">
              <div className="ml-field">
                <label>Titre</label>
                <input
                  className="ml-input"
                  name="titre"
                  placeholder="Ex: Villa T4 à Ivandry"
                  defaultValue={draft?.titre ?? ""}
                />
              </div>

              <div className="ml-row-2">
                <div className="ml-field">
                  <label>Type offre</label>
                  <select className="ml-select" name="typeoffre" defaultValue={draft?.typeoffre ?? "Louer"}>
                    <option value="Louer">Louer</option>
                    <option value="Vendre">Vendre</option>
                  </select>
                </div>

                <div className="ml-field">
                  <label>Type bien</label>
                  <input
                    className="ml-input"
                    name="typebien"
                    defaultValue={draft?.typebien ?? ""}
                    placeholder="Maison, Appartement, Terrain…"
                  />
                </div>
              </div>

              <div className="ml-row-2">
                <div className="ml-field">
                  <label>Ville</label>
                  <input
                    className="ml-input"
                    name="ville"
                    defaultValue={draft?.ville ?? ""}
                    placeholder="Antananarivo, Toamasina…"
                  />
                </div>

                <div className="ml-field">
                  <label>Quartier</label>
                  <input
                    className="ml-input"
                    name="quartier"
                    defaultValue={draft?.quartier ?? ""}
                    placeholder="Ivandry, Ivato…"
                  />
                </div>
              </div>

              <div className="ml-row-2">
                <div className="ml-field">
                  <label>Prix (Ar)</label>
                  <input
                    className="ml-input"
                    name="prixar"
                    inputMode="numeric"
                    defaultValue={draft?.prixar ?? ""}
                    placeholder="Ex: 400000000"
                  />
                </div>

                <div className="ml-field">
                  <label>Surface</label>
                  <input
                    className="ml-input"
                    name="surface"
                    inputMode="decimal"
                    defaultValue={draft?.surface ?? ""}
                    placeholder="Ex: 520"
                  />
                </div>
              </div>

              <div className="ml-row-2">
                <div className="ml-field">
                  <label>Chambres</label>
                  <input
                    className="ml-input"
                    name="chambres"
                    inputMode="numeric"
                    defaultValue={draft?.chambres ?? ""}
                    placeholder="Ex: 4"
                  />
                </div>
                <div className="ml-field">
                  <label>SDB</label>
                  <input
                    className="ml-input"
                    name="sdb"
                    inputMode="numeric"
                    defaultValue={draft?.sdb ?? ""}
                    placeholder="Ex: 2"
                  />
                </div>
              </div>

              <div className="ml-field">
                <label>Images (1 URL par ligne)</label>
                <textarea
                  className="ml-textarea"
                  name="images_raw"
                  rows={4}
                  placeholder={"https://...\nhttps://..."}
                  defaultValue={(draft?.images ?? []).join("\n")}
                />
                <div className="ml-help">Astuce : privilégie des URLs rapides (Supabase Storage/CDN).</div>
              </div>

              <div className="ml-field">
                <label>Description</label>
                <textarea className="ml-textarea" name="description" rows={7} defaultValue={draft?.description ?? ""} />
                <div className="ml-help">
                  Astuce : tu peux cliquer <b>Appliquer</b> dans l’optimiseur SEO pour remplacer cette description automatiquement.
                </div>
              </div>

              <div className="ml-row-2">
                <div className="ml-field">
                  <label>WhatsApp</label>
                  <input className="ml-input" name="whatsapp" placeholder="034xxxxxxx / +261…" defaultValue={draft?.whatsapp ?? ""} />
                </div>

                <div className="ml-field">
                  <label>Publié</label>
                  <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
                    <input name="publie" type="checkbox" defaultChecked={draft?.publie ?? false} />
                    <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 13 }}>
                      Cocher uniquement quand tu donnes le feu vert
                    </span>
                  </label>
                </div>
              </div>

              <div className="ml-row-2">
                <div className="ml-field">
                  <label>Lat</label>
                  <input className="ml-input" name="lat" defaultValue={draft?.lat ?? ""} placeholder="-18.9" />
                </div>
                <div className="ml-field">
                  <label>Lng</label>
                  <input className="ml-input" name="lng" defaultValue={draft?.lng ?? ""} placeholder="47.5" />
                </div>
              </div>

              <div className="ml-btn-row">
                <button className="ml-btn" type="submit" formAction={saveDraftAnnonceAction}>
                  Enregistrer en brouillon
                </button>
                <button className="ml-btn ml-btn-primary" type="submit">
                  Créer
                </button>
              </div>

              <div className="ml-help">
                ✅ <b>Brouillon</b> : enregistre en base avec <b>publie=false</b> (même si la case est cochée). <br />
                ⚠️ <b>Créer</b> : respecte la case Publié.
              </div>
            </form>
          </div>

          {/* RIGHT */}
          <aside className="ml-card">
            <h2>Annonces</h2>
            <p>Derniers enregistrements dans Supabase (brouillon / publié).</p>

            <div className="ml-list">
              {(annonces ?? []).map((a) => (
                <div key={a.id} className="ml-item">
                  <div>
                    <h3>{a.titre}</h3>
                    <div className="meta">
                      {a.ville ?? "-"} • {a.quartier ?? "-"} • {a.typeoffre ?? "-"} • {a.prixar ? `${a.prixar} Ar` : "-"}
                      <br />
                      {a.publie ? (
                        <span className="ml-badge ml-badge-ok">✅ Publié</span>
                      ) : (
                        <span className="ml-badge ml-badge-warn">⏳ Brouillon</span>
                      )}
                    </div>
                  </div>

                  <form action={deleteAnnonceAction}>
                    <input type="hidden" name="id" value={a.id} />
                    <button className="ml-btn ml-btn-danger" type="submit">
                      Supprimer
                    </button>
                  </form>
                </div>
              ))}
            </div>

            <div className="ml-footer-note">
              Astuce : garde tout en <b>brouillon</b> tant que la fiche n’est pas validée.
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
