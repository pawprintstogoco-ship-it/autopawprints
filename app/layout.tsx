import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PawPrints Automation",
  description: "Etsy order automation for custom digital pet portraits."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
