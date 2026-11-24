import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { Plus_Jakarta_Sans } from "next/font/google";
import { MotionProvider } from "@/components/motion/provider";
import { LocaleRoot } from "@/components/i18n/locale-root";
import { getTranslate } from "@/components/i18n/server";
import "./globals.css";

// Self-hosted at build time by next/font (no request to Google at runtime). Latin covers both
// English and Bahasa Indonesia. `--font-sans` in globals.css reads this variable.
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

/**
 * The default title and description, in the visitor's language. Each surface sets its own title
 * template in its layout (marketing, platform admin, customer site, restaurant admin). The language
 * is request data, so this defers to request time, like the rest of the tree (`LocaleRoot`).
 */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslate();
  return {
    title: { default: t("meta.title"), template: `%s · ${t("auth.screen.brand")}` },
    description: t("meta.description"),
  };
}

/** Tells Next.js the dynamic metadata is intentional; renders nothing (Cache Components). */
async function Connection() {
  await connection();
  return null;
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakarta.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Suspense>
          <Connection />
        </Suspense>
        <MotionProvider>
          <LocaleRoot>{children}</LocaleRoot>
        </MotionProvider>
      </body>
    </html>
  );
}
