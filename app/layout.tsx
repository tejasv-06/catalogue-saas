import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tesolute — AI Catalogue Listings",
  description: "AI-powered catalogue listing tool for e-commerce sellers and agencies.",
  manifest: "/site.webmanifest",
  icons: {
    // favicon.ico and apple-icon.png live in app/ and are auto-detected by
    // Next.js file convention — only the /public icons need declaring here.
    icon: [
      { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/web-app-manifest-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/web-app-manifest-512x512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The pre-paint script below sets data-theme on this element before
      // React hydrates, based on localStorage — something the server can't
      // know when it renders. That's an intentional, expected mismatch (the
      // same technique next-themes and similar libraries use), not a bug to
      // fix by removing the script.
      suppressHydrationWarning
    >
      <head>
        {/* Runs before paint so a saved "light" preference doesn't flash the
            dark theme first — sets the same data-theme attribute ThemeToggle
            manages at runtime. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try {
              if (localStorage.getItem('theme') === 'light') {
                document.documentElement.setAttribute('data-theme', 'light');
              }
            } catch (e) {}`
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
