import type { Metadata, Viewport } from "next";
import { Poppins, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/context/WalletContext";
import { AuthProvider } from "@/context/AuthContext";
import { ToastProvider } from "@/components/ui/Toast";
import { ExpenseProvider } from "@/context/ExpenseContext";
import { TripProvider } from "@/context/TripContext";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import { ObservabilityInit } from "@/components/observability/ObservabilityInit";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { NetworkGuardBanner } from "@/components/wallet/NetworkGuardBanner";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-poppins",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || 
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://settlex.app")
  ),
  title: {
    default: "SettleX — Split Bills on the Stellar Blockchain",
    template: "%s | SettleX",
  },
  description:
    "SettleX is a decentralized bill-splitting app built on the Stellar blockchain. Split expenses, pay instantly with XLM, track with QR codes — all trustless, all transparent.",
  keywords: [
    "Stellar",
    "blockchain",
    "bill splitting",
    "crypto payments",
    "XLM",
    "Freighter wallet",
    "decentralized",
    "group expenses",
    "web3",
  ],
  authors: [{ name: "SettleX Team" }],
  creator: "SettleX",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://settlex.app",
    siteName: "SettleX",
    title: "SettleX — Split Bills on the Stellar Blockchain",
    description:
      "Decentralized bill-splitting powered by Stellar. Split instantly, pay transparently.",
    // Social image is provided by app/opengraph-image.tsx (file convention).
  },
  twitter: {
    card: "summary_large_image",
    title: "SettleX — Split Bills on the Stellar Blockchain",
    description: "Decentralized bill-splitting powered by Stellar.",
    // Image provided by app/twitter-image.tsx (file convention).
  },
  // Icons are provided by app/icon.svg + app/apple-icon.tsx (file conventions).
  applicationName: "SettleX",
  appleWebApp: {
    capable: true,
    title: "SettleX",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#B9FF66",
  width: "device-width",
  initialScale: 1,
  // Extend under the iOS notch / home indicator so safe-area insets work in the
  // installed PWA.
  viewportFit: "cover",
};

import { Poppins } from "next/font/google";

const poppins = Poppins({
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-poppins",
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`scroll-smooth ${poppins.variable}`}>
      <body className="bg-[#F6F6F6] text-[#0F0F14] font-sans antialiased font-[family-name:var(--font-poppins)]">
        {/* First in the tree: attaches error reporting before any provider
            below it can throw. Renders nothing. */}
        <ObservabilityInit />
        <ToastProvider>
          <WalletProvider>
            <NetworkGuardBanner />
            <AuthProvider>
              <ExpenseProvider>
                <TripProvider>
                  {children}
                  <InstallPrompt />
                </TripProvider>
              </ExpenseProvider>
            </AuthProvider>
          </WalletProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
