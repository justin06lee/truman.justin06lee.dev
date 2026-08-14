import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";

import { DialogProvider } from "@/components/chrome/dialog";
import { ToastProvider } from "@/components/chrome/toast";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "truman",
  description: "a camera, pointed at me, for people who have the password.",
  // The whole site is behind a password; there is nothing here for a crawler
  // to find and no reason to advertise that it exists.
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistMono.variable} dark h-full antialiased`}>
      <body className="min-h-full bg-black text-white flex flex-col">
        <ToastProvider>
          <DialogProvider>{children}</DialogProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
