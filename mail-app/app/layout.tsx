import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lorium Mail",
  description: "Private correspondence for Lorium.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
