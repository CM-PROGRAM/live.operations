import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Provedores } from "@/frontend/layout/provedores"
import "./globals.css"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  title: { default: "LiveOps", template: "%s · LiveOps" },
  description: "Operações da Suplelive",
  icons: { icon: "/logo.png" },
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: o next-themes troca a classe do tema antes
    // da hidratação, de propósito, para não piscar claro no modo escuro.
    <html lang="pt-BR" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Provedores>{children}</Provedores>
      </body>
    </html>
  )
}
