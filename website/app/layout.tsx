import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Mesh Protocol (AMP) — Agents find each other. No hardcoded URLs.",
  description:
    "AMP is an open protocol for AI agent discovery, matching, and secure communication across organizational boundaries.",
  openGraph: {
    title: "Agent Mesh Protocol (AMP)",
    description:
      "Open protocol for AI agent discovery, matching, and secure cross-org communication.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#09090b] text-[#e4e4e7]">
        {children}
      </body>
    </html>
  );
}
