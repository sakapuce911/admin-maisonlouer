"use server";

/* =========================================================
   File: src/app/admin/actions.ts
   Admin MaisonLouer — Server Actions

   - Auth obligatoire pour /admin
   - CRUD annonces
   - Import UI (URL + OCR text) -> crée un "brouillon" (cookie)
   - Extraction V1 depuis URL (OG tags + heuristiques)
   - ✅ OCR fait côté client (tesseract.js gratuit)
   - ✅ NOUVELLE RÈGLE : reformulation automatique (titre + description)
   - AUCUNE publication automatique (publie = false par défaut)
========================================================= */

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// ⚠️ IMPORTANT : pas d'alias @ ici
import { supabaseServer } from "../../lib/supabase/server";

/* =========================
   Helpers FormData
========================= */
function getString(fd: FormData, key: string) {
  const v = fd.get(key);
  if (typeof v === "string") {
    const s = v.trim();
    return s.length ? s : null;
  }
  return null;
}

function getNumber(fd: FormData, key: string) {
  const v = getString(fd, key);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getBool(fd: FormData, key: string) {
  const v = fd.get(key);
  if (typeof v === "string") return v === "true" || v === "on" || v === "1";
  return false;
}

function splitImages(raw: string | null) {
  if (!raw) return [];
  return raw
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function squashSpaces(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function clamp(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

/* =========================
   Auth
========================= */
async function requireAuth() {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) redirect("/login");
  return { supabase, user: data.user };
}

export async function signOutAction() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  const jar = await cookies();
  jar.set("ml_draft_annonce", "", { path: "/", maxAge: 0 });
  redirect("/login");
}

/* =========================
   DRAFT
========================= */
export type DraftAnnonce = {
  source_url?: string | null;
  titre?: string | null;
  typeoffre?: string | null;
  typebien?: string | null;
  ville?: string | null;
  quartier?: string | null;
  prixar?: number | null;
  chambres?: number | null;
  sdb?: number | null;
  surface?: number | null;
  images?: string[];
  description?: string | null;
  whatsapp?: string | null;
  lat?: number | null;
  lng?: number | null;
  publie?: boolean;
};

/* =========================
   Parsing helpers (URL/OCR)
========================= */
function guessTypeOffre(text: string) {
  const t = text.toLowerCase();
  if (/(à\s*vendre|a\s*vendre|vente|vendre)/i.test(t)) return "Vendre";
  if (/(à\s*louer|a\s*louer|location|louer)/i.test(t)) return "Louer";
  return null;
}

function parsePriceAr(text: string) {
  const t = text.replace(/\u00A0/g, " ");

  // "400 millions" / "1.5M"
  const mM = t.match(/(\d+(?:[.,]\d+)?)\s*(m|million|millions)\b/i);
  if (mM) {
    const val = Number(mM[1].replace(",", "."));
    if (Number.isFinite(val)) return Math.round(val * 1_000_000);
  }

  // "400 000 000 Ar"
  const m = t.match(/(\d[\d\s.,]{3,})\s*(ar|ariary|mga)\b/i);
  if (m) {
    const raw = m[1].replace(/[^\d]/g, "");
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }

  return null;
}

function parseSurface(text: string) {
  const m = text.match(/(\d{2,5})\s*(m2|m²)\b/i);
  if (m) return Number(m[1]);
  return null;
}

function parseWhatsapp(text: string) {
  const m =
    text.match(/(\+261\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{2})/i) ||
    text.match(/\b(03\d\s?\d{2}\s?\d{3}\s?\d{2})\b/i);
  return m?.[1]?.replace(/\s+/g, "") ?? null;
}

function parseVille(text: string) {
  const cities = [
    "Antananarivo",
    "Tana",
    "Toamasina",
    "Tamatave",
    "Mahajanga",
    "Majunga",
    "Fianarantsoa",
    "Antsirabe",
    "Toliara",
    "Tuléar",
    "Diego",
    "Antsiranana",
    "Nosy Be",
    "Ivato",
  ];
  for (const c of cities) {
    const re = new RegExp(`\\b${c.replace(/ /g, "\\s+")}\\b`, "i");
    if (re.test(text)) return c === "Tana" ? "Antananarivo" : c;
  }
  return null;
}

function parseQuartier(text: string) {
  const m1 = text.match(/quartier\s*[:\-]\s*([A-Za-zÀ-ÖØ-öø-ÿ' -]{3,40})/i);
  if (m1) return m1[1].trim();

  const m2 = text.match(/\b(?:à|a)\s+([A-Za-zÀ-ÖØ-öø-ÿ' -]{3,30})\b/i);
  if (m2) {
    const q = m2[1].trim();
    if (q.length >= 3 && q.length <= 30) return q;
  }

  return null;
}

function guessTitleFromText(text: string) {
  const lines = text
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 14);

  for (const l of lines) {
    const s = squashSpaces(l);
    if (/(à\s*vendre|a\s*vendre|à\s*louer|a\s*louer|villa|maison|appartement|duplex|terrain)/i.test(s) && s.length >= 10) {
      return s.slice(0, 140);
    }
  }

  return lines[0] ? squashSpaces(lines[0]).slice(0, 140) : null;
}

/* =========================
   URL extraction (OG tags)
========================= */
function pickFirst<T>(arr: (T | null | undefined)[]) {
  for (const v of arr) {
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

function normalizeUrl(maybeUrl: string, baseUrl: string) {
  try {
    return new URL(maybeUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

function getMeta(html: string, key: string) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=(?:"|')${key}(?:"|')[^>]+content=(?:"|')([^"']+)(?:"|')[^>]*>`,
    "i"
  );
  const m = html.match(re);
  return m?.[1]?.trim() ?? null;
}

function getTitleTag(html: string) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1]?.trim() ?? null;
}

function buildDraftFromHtml(html: string, sourceUrl: string): DraftAnnonce {
  const ogTitle = getMeta(html, "og:title");
  const twTitle = getMeta(html, "twitter:title");
  const titleTag = getTitleTag(html);

  const ogDesc = getMeta(html, "og:description");
  const desc = getMeta(html, "description");
  const twDesc = getMeta(html, "twitter:description");

  const rawTitle = pickFirst([ogTitle, twTitle, titleTag]) ?? null;
  const rawDesc = pickFirst([ogDesc, twDesc, desc]) ?? null;

  const ogImage = getMeta(html, "og:image");
  const twImage = getMeta(html, "twitter:image");

  const images: string[] = [];
  for (const img of [ogImage, twImage]) {
    if (!img) continue;
    const n = normalizeUrl(img, sourceUrl);
    if (n && !images.includes(n)) images.push(n);
  }

  const fullTextForParsing = `${rawTitle ?? ""}\n${rawDesc ?? ""}\n${html.slice(0, 20000)}`;

  return {
    source_url: sourceUrl,
    titre: rawTitle,
    description: rawDesc,
    typeoffre: guessTypeOffre(fullTextForParsing),
    prixar: parsePriceAr(fullTextForParsing),
    surface: parseSurface(fullTextForParsing),
    ville: parseVille(fullTextForParsing),
    quartier: parseQuartier(fullTextForParsing),
    whatsapp: parseWhatsapp(fullTextForParsing),
    images,
    publie: false,
  };
}

async function fetchHtml(url: string) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
      accept: "text/html,application/xhtml+xml",
    },
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Fetch échoué (${res.status})`);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/html")) throw new Error(`Le lien ne renvoie pas du HTML (content-type: ${ct})`);
  return await res.text();
}

/* =========================
   OCR text -> draft
========================= */
function buildDraftFromOcrText(ocrText: string): Partial<DraftAnnonce> {
  const text = (ocrText ?? "").replace(/\u00A0/g, " ").trim();

  const titre = guessTitleFromText(text);
  const typeoffre = guessTypeOffre(text);
  const prixar = parsePriceAr(text);
  const surface = parseSurface(text);
  const ville = parseVille(text);
  const quartier = parseQuartier(text);
  const whatsapp = parseWhatsapp(text);

  const description = text.length > 1500 ? text.slice(0, 1500) + "\n…" : text;

  return {
    titre: titre ?? null,
    typeoffre: typeoffre ?? null,
    prixar: prixar ?? null,
    surface: surface ?? null,
    ville: ville ?? null,
    quartier: quartier ?? null,
    whatsapp: whatsapp ?? null,
    description: description || null,
  };
}

/* =========================
   ✅ REFORMULATION MARKETING (gratuite, sans IA payante)
   - utilise UNIQUEMENT les infos extraites (URL/OCR)
   - structure : accroche + points clés + prix + CTA
========================= */
function extractHighlights(sourceText: string) {
  const t = sourceText || "";
  const patterns: Array<{ re: RegExp; label: string }> = [
    { re: /proche\s*(?:de|du)\s*la?\s*route\s*principale/i, label: "À 5 min de la route principale" },
    { re: /\bquartier\s*(?:calme|sécurisé|recherché)\b/i, label: "Quartier recherché" },
    { re: /parking|place\s*de\s*parking/i, label: "Parking possible" },
    { re: /grande\s*cour|cour\s*spacieuse/i, label: "Grande cour" },
    { re: /duplex/i, label: "Duplex" },
    { re: /villa\s*moderne|moderne/i, label: "Potentiel villa moderne" },
    { re: /investissement/i, label: "Idéal investissement" },
    { re: /famille|familiale/i, label: "Parfait pour une famille" },
    { re: /terrain\s*(?:de|:)?\s*(\d{2,5})\s*(m2|m²)/i, label: "Terrain spacieux" },
    { re: /gros\s*oeuvre|gros\s*œuvre/i, label: "En gros œuvre (à finaliser)" },
    { re: /clé\s*en\s*main/i, label: "Option clé en main" },
  ];

  const found: string[] = [];
  for (const p of patterns) {
    if (p.re.test(t) && !found.includes(p.label)) found.push(p.label);
    if (found.length >= 6) break;
  }

  return found;
}

function formatPriceAr(prixar: number | null | undefined) {
  if (!prixar) return null;
  const s = prixar.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${s} Ar`;
}

function buildMarketingTitle(d: DraftAnnonce) {
  const offer = d.typeoffre === "Vendre" ? "À VENDRE" : d.typeoffre === "Louer" ? "À LOUER" : "OPPORTUNITÉ";
  const type = d.typebien ? d.typebien : "Bien immobilier";
  const locParts = [d.quartier, d.ville].filter(Boolean);
  const loc = locParts.length ? `— ${locParts.join(", ")}` : "";
  const surface = d.surface ? `• ${d.surface} m²` : "";
  const price = d.prixar ? `• ${formatPriceAr(d.prixar)}` : "";

  // Titre court, vendeur, stable
  const title = `${offer} : ${type} ${loc} ${surface} ${price}`.replace(/\s+/g, " ").trim();
  return clamp(title, 90);
}

function buildMarketingDescription(d: DraftAnnonce, sourceText: string) {
  const offer = d.typeoffre === "Vendre" ? "vente" : d.typeoffre === "Louer" ? "location" : "opportunité";
  const locParts = [d.quartier, d.ville].filter(Boolean);
  const loc = locParts.length ? locParts.join(", ") : "Madagascar";

  const highlights = extractHighlights(sourceText);

  const lines: string[] = [];

  // Accroche
  lines.push(`✨ Découvrez cette belle opportunité de ${offer} à ${loc}.`);

  // Résumé factuel
  const facts: string[] = [];
  if (d.typebien) facts.push(d.typebien);
  if (d.surface) facts.push(`${d.surface} m²`);
  if (d.chambres) facts.push(`${d.chambres} chambre(s)`);
  if (d.sdb) facts.push(`${d.sdb} SDB`);
  if (facts.length) lines.push(`🏡 Caractéristiques : ${facts.join(" • ")}.`);

  // Avantages détectés
  if (highlights.length) {
    lines.push(`✅ Points forts :`);
    for (const h of highlights) lines.push(`- ${h}`);
  }

  // Prix
  const price = formatPriceAr(d.prixar ?? null);
  if (price) lines.push(`💰 Prix : ${price}.`);

  // CTA
  if (d.whatsapp) {
    lines.push(`📲 Contact WhatsApp : ${d.whatsapp}`);
  } else {
    lines.push(`📲 Contact : écrivez-nous sur WhatsApp pour plus d’infos et une visite.`);
  }

  // Petit disclaimer "anti-hallucination"
  lines.push(`ℹ️ Infos générées à partir de la source (URL / capture). Merci de vérifier avant publication.`);

  return clamp(lines.join("\n"), 1800);
}

function applyMarketingRewrite(draft: DraftAnnonce, sourceText: string) {
  // On reformule uniquement si on a un minimum d’infos
  const hasAnySignal =
    !!draft.titre ||
    !!draft.description ||
    !!draft.typeoffre ||
    !!draft.typebien ||
    !!draft.ville ||
    !!draft.quartier ||
    !!draft.prixar ||
    !!sourceText;

  if (!hasAnySignal) return draft;

  const newTitle = buildMarketingTitle(draft);
  const newDesc = buildMarketingDescription(draft, sourceText);

  return {
    ...draft,
    titre: newTitle || draft.titre || null,
    description: newDesc || draft.description || null,
  };
}

/* =========================
   IMPORT ACTION (URL + OCR TEXT)
========================= */
export async function analyzeSourceAction(fd: FormData) {
  await requireAuth();

  const url = getString(fd, "source_url");
  const ocrText = getString(fd, "ocr_text");

  // base draft
  let draft: DraftAnnonce = {
    source_url: url,
    titre: null,
    typeoffre: null,
    typebien: null,
    ville: null,
    quartier: null,
    prixar: null,
    chambres: null,
    sdb: null,
    surface: null,
    images: [],
    description: null,
    whatsapp: null,
    lat: null,
    lng: null,
    publie: false,
  };

  let sourceTextForRewrite = "";

  // 1) URL -> extraction V1
  if (url) {
    try {
      const html = await fetchHtml(url);
      const fromUrl = buildDraftFromHtml(html, url);
      draft = { ...draft, ...fromUrl };
      draft.publie = false;

      // on garde du texte source pour reformulation (sans mettre tout le HTML)
      sourceTextForRewrite += `\n${fromUrl.titre ?? ""}\n${fromUrl.description ?? ""}\n`;
    } catch (e: any) {
      draft.description =
        `⚠️ Import URL impossible : ${e?.message ?? "erreur inconnue"}\n` +
        (draft.description ? `\n${draft.description}` : "");
      draft.publie = false;
    }
  }

  // 2) OCR text (depuis le navigateur)
  if (ocrText) {
    const fromOcr = buildDraftFromOcrText(ocrText);

    draft = {
      ...draft,
      titre: draft.titre ?? fromOcr.titre ?? null,
      typeoffre: draft.typeoffre ?? fromOcr.typeoffre ?? null,
      prixar: draft.prixar ?? fromOcr.prixar ?? null,
      surface: draft.surface ?? fromOcr.surface ?? null,
      ville: draft.ville ?? fromOcr.ville ?? null,
      quartier: draft.quartier ?? fromOcr.quartier ?? null,
      whatsapp: draft.whatsapp ?? fromOcr.whatsapp ?? null,
      description:
        (draft.description ? `${draft.description}\n\n` : "") +
        (fromOcr.description ? `🧾 Texte détecté (OCR) :\n${fromOcr.description}` : "🧾 OCR: aucun texte détecté."),
      publie: false,
    };

    sourceTextForRewrite += `\n${ocrText}\n`;
  }

  // ✅ 3) NOUVELLE RÈGLE : Reformulation automatique (titre + description)
  // (utilise uniquement les infos extraites, pas d’invention)
  draft = applyMarketingRewrite(draft, sourceTextForRewrite);

  // note UX (facultatif)
  draft.description =
    (draft.description ? `${draft.description}\n\n` : "") +
    `✍️ Titre & description reformulés automatiquement pour attirer le client (à vérifier avant publication).`;

  // Sauvegarde cookie draft
  const jar = await cookies();
  jar.set("ml_draft_annonce", JSON.stringify(draft), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60,
  });

  revalidatePath("/admin");
  redirect("/admin");
}

export async function clearDraftAction() {
  await requireAuth();
  const jar = await cookies();
  jar.set("ml_draft_annonce", "", { path: "/", maxAge: 0 });
  revalidatePath("/admin");
  redirect("/admin");
}

/* =========================
   Save Draft to Supabase (publie=false)
========================= */
export async function saveDraftAnnonceAction(fd: FormData) {
  const { supabase } = await requireAuth();

  const titre = getString(fd, "titre");
  if (!titre) throw new Error("Titre obligatoire (même pour un brouillon).");

  const payload = {
    titre,
    typeoffre: getString(fd, "typeoffre") ?? "",
    typebien: getString(fd, "typebien"),
    ville: getString(fd, "ville"),
    quartier: getString(fd, "quartier"),
    prixar: getNumber(fd, "prixar"),
    chambres: getNumber(fd, "chambres"),
    sdb: getNumber(fd, "sdb"),
    surface: getNumber(fd, "surface"),
    images: splitImages(getString(fd, "images_raw")),
    description: getString(fd, "description"),
    whatsapp: getString(fd, "whatsapp"),
    lat: getNumber(fd, "lat"),
    lng: getNumber(fd, "lng"),
    publie: false, // ✅ FORCE BROUILLON
  };

  const { error } = await supabase.from("annonces").insert(payload);
  if (error) throw new Error(error.message);

  const jar = await cookies();
  jar.set("ml_draft_annonce", "", { path: "/", maxAge: 0 });

  revalidatePath("/admin");
  redirect("/admin");
}

/* =========================
   CRUD Annonces (Supabase)
========================= */
export async function createAnnonceAction(fd: FormData) {
  const { supabase } = await requireAuth();

  const titre = getString(fd, "titre");
  if (!titre) throw new Error("Titre obligatoire.");

  const payload = {
    titre,
    typeoffre: getString(fd, "typeoffre") ?? "",
    typebien: getString(fd, "typebien"),
    ville: getString(fd, "ville"),
    quartier: getString(fd, "quartier"),
    prixar: getNumber(fd, "prixar"),
    chambres: getNumber(fd, "chambres"),
    sdb: getNumber(fd, "sdb"),
    surface: getNumber(fd, "surface"),
    images: splitImages(getString(fd, "images_raw")),
    description: getString(fd, "description"),
    whatsapp: getString(fd, "whatsapp"),
    lat: getNumber(fd, "lat"),
    lng: getNumber(fd, "lng"),
    publie: getBool(fd, "publie"),
  };

  const { error } = await supabase.from("annonces").insert(payload);
  if (error) throw new Error(error.message);

  const jar = await cookies();
  jar.set("ml_draft_annonce", "", { path: "/", maxAge: 0 });

  revalidatePath("/admin");
  redirect("/admin");
}

export async function deleteAnnonceAction(fd: FormData) {
  const { supabase } = await requireAuth();
  const id = getString(fd, "id");
  if (!id) throw new Error("ID manquant.");

  const { error } = await supabase.from("annonces").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
  redirect("/admin");
}
