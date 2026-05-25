import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedVoice — AI Clinical Appointments",
  description: "Real-time multilingual voice AI for clinical appointment booking",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="noise">{children}</body>
    </html>
  );
}
