# Como este repositório é publicado

O sistema é servido pelo GitHub Pages a partir de `index.html` na raiz do
branch `main`.

## Por que existe o arquivo `.nojekyll`

O GitHub Pages, por padrão, passa o repositório inteiro pelo Jekyll antes de
publicar. O Jekyll trata `{{ ... }}` como template dele — e a pasta `docs/`
está cheia de expressões do n8n exatamente com essa cara
(`{{ $json.envioId }}`). Quando o Jekyll não consegue interpretar uma delas,
ele **não pula o arquivo: aborta o build inteiro**, e o `index.html` deixa de
ser publicado junto.

Foi o que aconteceu em 17/08/2026: o sistema ficou quatro horas parado na
versão `2026.08.16t` enquanto os commits seguintes eram enviados normalmente
— o push funcionava, a publicação é que morria calada.

O `.nojekyll` desliga esse processamento. Os arquivos passam a ser servidos
como estão, que é tudo o que este projeto precisa: um HTML único, sem build.

**Não apague esse arquivo**, mesmo parecendo vazio e inútil.

## Conferir se a publicação passou

Na aba **Actions** do repositório, o job "pages build and deployment" do
último commit tem que estar verde. Se estiver vermelho, o site continua no ar
com a versão anterior — e ninguém é avisado.

O jeito rápido pela tela: o `versao.json` publicado tem que bater com o
`APP_VERSAO` do `index.html`.
