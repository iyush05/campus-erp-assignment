import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campus — Academic workspace",
  description: "One student record. A calmer campus. Attendance, academics and fees in one workspace.",
  manifest: '/manifest.webmanifest',
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
