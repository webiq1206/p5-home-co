import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "P5 Home Co | Four Expert Home-Service Companies",
  description: "P5 Home Co is the parent company behind Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co, and Boise Handyman Co, serving Idaho's Treasure Valley.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
