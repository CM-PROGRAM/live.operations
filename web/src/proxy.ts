import { NextResponse, type NextRequest } from "next/server"

/* Checagem otimista: só olha se o cookie existe, para mandar quem nunca
   entrou direto ao login sem renderizar nada. Quem decide de verdade é
   usuarioAtual() (src/backend/auth/sessao.ts), perto do dado. */
export function proxy(req: NextRequest) {
  const temCookie = req.cookies.has("liveops_sessao")
  const naTelaDeEntrar = req.nextUrl.pathname === "/entrar"
  if (!temCookie && !naTelaDeEntrar) return NextResponse.redirect(new URL("/entrar", req.nextUrl))
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|ico)$).*)"],
}
