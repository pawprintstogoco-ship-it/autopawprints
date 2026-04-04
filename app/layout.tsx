import type { Metadata } from "next";
import { Newsreader, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const displayFont = Newsreader({
  subsets: ["latin"],
  variable: "--font-display"
});

const bodyFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-body"
});

export const metadata: Metadata = {
  metadataBase: new URL("https://pawprints.ca"),
  title: "PawprintsCA",
  description: "Upload your photo for a PawprintsCA artist to work on your portrait.",
  openGraph: {
    title: "PawprintsCA",
    description: "Upload your photo for a PawprintsCA artist to work on your portrait.",
    images: ["/brand/pawprintsdrawing2.png"]
  },
  twitter: {
    title: "PawprintsCA",
    description: "Upload your photo for a PawprintsCA artist to work on your portrait.",
    images: ["/brand/pawprintsdrawing2.png"]
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${bodyFont.variable}`}>{children}</body>
    </html>
  );
}
