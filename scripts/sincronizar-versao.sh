#!/usr/bin/env bash
# Copia a versão que está dentro do index.html para o versao.json.
#
# Os dois precisam dizer a mesma coisa: o index.html é o que a máquina roda e
# o versao.json é o que ela consulta para saber se ficou para trás. Quando os
# dois discordam, a barra azul de "atualize o sistema" passa a mentir — foi o
# que aconteceu em 23/08/2026, com o versao.json parado numa versão anterior à
# publicada.
#
# Rodar sempre depois de mexer no APP_VERSAO, antes do commit.
set -euo pipefail
cd "$(dirname "$0")/.."

versao="$(grep -o "APP_VERSAO='[^']*'" index.html | head -1 | cut -d"'" -f2)"
if [ -z "$versao" ]; then
  echo "não achei APP_VERSAO no index.html" >&2
  exit 1
fi

# Antes de carimbar a versão, conferir se a página ainda fecha as tags que abre.
# Em 01/09/2026 um </div> apagado a mais deixou o JS válido, os ids únicos e a
# tela inteira em branco: tudo o que vinha depois virou filho de um bloco
# display:none. Publicar isso custou uma reunião do master.
node scripts/checar-estrutura.js || {
  echo "" >&2
  echo "NÃO vou sincronizar a versão com a estrutura quebrada." >&2
  exit 1
}

printf '{"versao": "%s"}\n' "$versao" > versao.json
echo "versao.json → $versao"
