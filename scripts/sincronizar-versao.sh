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

printf '{"versao": "%s"}\n' "$versao" > versao.json
echo "versao.json → $versao"
