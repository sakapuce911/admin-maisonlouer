/* =========================================================
   File: src/app/manifest.ts
========================================================= */

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MaisonLouer Admin",
    short_name: "ML Admin",
    description: "Back-office MaisonLouer",
    start_url: "/",
    display: "standalone",
    background_color: "#071a2d",
    theme_color: "#071a2d",
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
