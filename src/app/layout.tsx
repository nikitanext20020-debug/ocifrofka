import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["cyrillic", "latin"],
});

export const metadata: Metadata = {
  title: "Оцифровка обращений",
  description: "Распознавание заявлений и перенос данных в Excel с помощью ИИ",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
