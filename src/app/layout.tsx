// File: src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Admin MaisonLouer",
  description: "Back-office MaisonLouer",

  // ✅ Icônes (favicon + iOS home screen)
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },

  // ✅ PWA manifest (nécessite src/app/manifest.ts)
  manifest: "/manifest.webmanifest",

  // ✅ Couleur navigateur (mobile)
  themeColor: "#071a2d",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
