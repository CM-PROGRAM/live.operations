import * as React from "react"

const MOBILE_BREAKPOINT = 768
const consulta = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/* useSyncExternalStore em vez de useEffect + setState: a largura da tela
   é um dado de fora do React, e esta é a forma que o React 19 pede para
   assinar esse tipo de dado sem renderizar duas vezes. */
function assinar(avisar: () => void) {
  const mql = window.matchMedia(consulta)
  mql.addEventListener("change", avisar)
  return () => mql.removeEventListener("change", avisar)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    assinar,
    () => window.matchMedia(consulta).matches,
    () => false
  )
}
