import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import "@pratham7711/ui/styles";
import "./globals.css";

export const metadata: Metadata = {
  title: "CreatorCore",
  description: "Creator economy management platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ThemeProvider attribute="data-theme" defaultTheme="dark" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
