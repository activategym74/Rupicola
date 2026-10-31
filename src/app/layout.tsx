import type { Metadata, Viewport } from "next";
import { Inter, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-cormorant" });

export const metadata: Metadata = {
  title: { default: "RUPÍCOLA", template: "%s · RUPÍCOLA" },
  description: "Gestión integral de restaurante, bar, cafetería, tienda y domicilios",
};
export const viewport: Viewport = { themeColor: "#791522", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO" className={`${inter.variable} ${cormorant.variable}`}>
      <body><ToastProvider>{children}</ToastProvider></body>
    </html>
  );
}
