import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth";
import { StoreProvider } from "@/lib/store-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reel Inventory",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        {/* attribute="data-theme" (not the next-themes default of a `.dark`
            class) keeps this compatible with the legacy toggleTheme(), which
            some parts of the old public/js/app.js still reference.
            storageKey="theme" reads/writes the same localStorage key too. */}
        <ThemeProvider
          attribute="data-theme"
          defaultTheme="light"
          enableSystem={false}
          storageKey="theme"
          disableTransitionOnChange
        >
          <AuthProvider>
            <StoreProvider>{children}</StoreProvider>
          </AuthProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
