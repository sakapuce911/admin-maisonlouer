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

   + ✅ NOUVEAU : Optimisation SEO (Gemini)
   + ✅ Verrou strict louer/vendre
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
    if (
      /(à\s*vendre|a\s*vendre|à\s*louer|a\s*louer|villa|maison|appartement|duplex|terrain)/i.test(s) &&
      s.length >= 10
    ) {
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

  const title = `${offer} : ${type} ${loc} ${surface} ${price}`.replace(/\s+/g, " ").trim();
  return clamp(title, 90);
}

function buildMarketingDescription(d: DraftAnnonce, sourceText: string) {
  const offer = d.typeoffre === "Vendre" ? "vente" : d.typeoffre === "Louer" ? "location" : "opportunité";
  const locParts = [d.quartier, d.ville].filter(Boolean);
  const loc = locParts.length ? locParts.join(", ") : "Madagascar";

  const highlights = extractHighlights(sourceText);
  const lines: string[] = [];

  lines.push(`✨ Découvrez cette belle opportunité de ${offer} à ${loc}.`);

  const facts: string[] = [];
  if (d.typebien) facts.push(d.typebien);
  if (d.surface) facts.push(`${d.surface} m²`);
  if (d.chambres) facts.push(`${d.chambres} chambre(s)`);
  if (d.sdb) facts.push(`${d.sdb} SDB`);
  if (facts.length) lines.push(`🏡 Caractéristiques : ${facts.join(" • ")}.`);

  if (highlights.length) {
    lines.push(`✅ Points forts :`);
    for (const h of highlights) lines.push(`- ${h}`);
  }

  const price = formatPriceAr(d.prixar ?? null);
  if (price) lines.push(`💰 Prix : ${price}.`);

  if (d.whatsapp) {
    lines.push(`📲 Contact WhatsApp : ${d.whatsapp}`);
  } else {
    lines.push(`📲 Contact : écrivez-nous sur WhatsApp pour plus d’infos et une visite.`);
  }

  lines.push(`ℹ️ Infos générées à partir de la source (URL / capture). Merci de vérifier avant publication.`);

  return clamp(lines.join("\n"), 1800);
}

function applyMarketingRewrite(draft: DraftAnnonce, sourceText: string) {
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

  if (url) {
    try {
      const html = await fetchHtml(url);
      const fromUrl = buildDraftFromHtml(html, url);
      draft = { ...draft, ...fromUrl };
      draft.publie = false;
      sourceTextForRewrite += `\n${fromUrl.titre ?? ""}\n${fromUrl.description ?? ""}\n`;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "erreur inconnue";
      draft.description =
        `⚠️ Import URL impossible : ${msg}\n` + (draft.description ? `\n${draft.description}` : "");
      draft.publie = false;
    }
  }

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

  draft = applyMarketingRewrite(draft, sourceTextForRewrite);

  draft.description =
    (draft.description ? `${draft.description}\n\n` : "") +
    `✍️ Titre & description reformulés automatiquement pour attirer le client (à vérifier avant publication).`;

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
    publie: false,
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

/* =========================================================
   ✅ SEO OPTIMIZER (Gemini)
========================================================= */

export type SeoOptimizeResult = {
  score: number;
  optimizedDescription: string;
  keywords: string[];
  improvements: string[];
};

function safeJsonFromText(raw: string) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function clampScore(n: unknown) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

// ✅ FIX VERCEL: pas de "implicit any"
function normalizeStringArray(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v: unknown) => String(v).trim())
    .filter((s: string) => s.length > 0)
    .slice(0, max);
}

// ✅ petit helper pour stabiliser Louer/Vendre
type TypeOffre = "Louer" | "Vendre";

function normalizeTypeOffre(raw: string | null): TypeOffre | null {
  const t = (raw ?? "").toLowerCase();
  if (t.includes("vend")) return "Vendre";
  if (t.includes("loue") || t.includes("loc")) return "Louer";
  return null;
}

export async function optimizeSeoDescriptionAction(fd: FormData): Promise<SeoOptimizeResult> {
  await requireAuth();

  const description = getString(fd, "description") ?? "";
  const city = getString(fd, "city") ?? "Antananarivo";
  const country = getString(fd, "country") ?? "Madagascar";

  // ✅ typeoffre doit venir de l’UI (select du formulaire)
  // fallback: si non fourni, on essaie de le deviner dans le texte, sinon Louer
  const typeoffre: TypeOffre = normalizeTypeOffre(getString(fd, "typeoffre")) ?? (guessTypeOffre(description) as TypeOffre) ?? "Louer";

  // ✅ Intent = UNIQUEMENT basé sur typeoffre
  const intent = typeoffre === "Louer" ? "maison à louer" : "maison à vendre";

  if (description.trim().length < 40) {
    throw new Error("Description trop courte. Ajoute plus de détails (≥ 40 caractères).");
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY manquant dans .env.local");

  // ✅ modèle par défaut (tu peux override via Vercel env GEMINI_MODEL)
  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.25,
      topP: 0.9,
      maxOutputTokens: 900,
    },
  });

  // 🔒 verrou strict louer/vendre
  const forbiddenWord = typeoffre === "Louer" ? "vendre" : "louer";
  const requiredWord = typeoffre === "Louer" ? "louer" : "vendre";

  const systemRules = [
    "Tu es un expert SEO immobilier francophone (Madagascar).",
    "Objectif: optimiser une DESCRIPTION d'annonce pour le référencement (Google) et la conversion.",
    `Marché: ${city} (Tana), ${country}.`,
    `Type d'offre OBLIGATOIRE: ${typeoffre}.`,
    "",
    "CONTRAINTE CRITIQUE (anti-hallucination):",
    "- Tu ne dois PAS inventer des faits (prix, quartier, nombre de chambres, superficie) s’ils ne sont pas présents dans le texte source.",
    "- Tu peux uniquement reformuler, structurer, clarifier, mettre en avant les infos déjà présentes.",
    "- Si une info manque, propose une amélioration sous forme de suggestion à compléter (dans 'improvements').",
    "",
    "CONTRAINTE CRITIQUE (type d’offre):",
    `- INTERDIT ABSOLU: ne jamais utiliser le mot "${forbiddenWord}" ni suggérer l'autre type d'offre.`,
    `- OBLIGATOIRE: le texte doit clairement être une annonce "${intent}" (pas les deux).`,
    "",
    "Style: clair, naturel, orienté client, mobile-friendly. Phrases courtes. Listes si utile.",
    "Ne pas ajouter de hashtags. Emojis: 0 à 2 max.",
    "Sortie STRICTEMENT en JSON valide (pas de texte autour).",
  ].join("\n");

  const prompt = `
Type d'offre: ${typeoffre}
Ville ciblée: ${city}
Pays: ${country}
Intention SEO: ${intent}

TEXTE SOURCE (à optimiser):
"""
${description}
"""

Rends un JSON strict avec ce schéma:
{
  "score": number,
  "optimizedDescription": string,
  "keywords": string[],
  "improvements": string[]
}

Contraintes:
- "optimizedDescription" doit être cohérent avec "${typeoffre}".
- Ne jamais mentionner "${forbiddenWord}" ni "à louer et à vendre".
- keywords: 8 à 15 expressions FR adaptées à ${city}, liées à "${intent}".
`.trim();

  const input = `${systemRules}\n\n${prompt}`;
  const result = await model.generateContent(input);

  const raw = result?.response?.text?.() || "";
  const parsed = safeJsonFromText(raw);

  if (!parsed) {
    return {
      score: 0,
      optimizedDescription: description,
      keywords: [],
      improvements: [
        "Impossible de parser la réponse Gemini en JSON. Vérifie GEMINI_API_KEY / GEMINI_MODEL.",
        "Astuce: assure-toi que Gemini répond uniquement en JSON (sans texte autour).",
      ],
    };
  }

  let optimizedDescription =
    typeof (parsed as any).optimizedDescription === "string"
      ? String((parsed as any).optimizedDescription).trim()
      : description;

  // ✅ GARDE-FOU serveur : supprime l'autre type offre si jamais Gemini l'insère
  const reForbidden =
    typeoffre === "Louer"
      ? /\b(à\s*vendre|a\s*vendre|vente|vendre)\b/gi
      : /\b(à\s*louer|a\s*louer|location|louer)\b/gi;

  optimizedDescription = optimizedDescription.replace(reForbidden, "").replace(/\s{2,}/g, " ").trim();

  // Si le mot requis n'apparait pas, on réinjecte une intro propre
  if (!new RegExp(`\\b${requiredWord}\\b`, "i").test(optimizedDescription)) {
    optimizedDescription = `${typeoffre === "Louer" ? "Maison à louer" : "Maison à vendre"} à ${city}, ${country}.\n\n${optimizedDescription}`.trim();
  }

  const keywords = normalizeStringArray((parsed as any).keywords, 20);
  const improvements = normalizeStringArray((parsed as any).improvements, 20);

  return {
    score: clampScore((parsed as any).score),
    optimizedDescription,
    keywords,
    improvements,
  };
}
