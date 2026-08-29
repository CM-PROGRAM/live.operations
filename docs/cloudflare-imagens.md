# Migração para a Cloudflare — Etapa 1: imagens no R2

## O que esta etapa faz (e o que ela NÃO faz)

As imagens do sistema passam a ter uma cópia no **R2**, o serviço de
arquivos da Cloudflare — onde guardar custa centavos (10 GB grátis) e
**baixar não custa nada**. A leitura de fotos passa a tentar o R2
primeiro, o que alivia a cota de download do Firebase.

**Nada do Firebase é desligado.** O sistema continua gravando cada
imagem no Firebase como sempre fez; o R2 recebe uma segunda via, em
paralelo. Se a Cloudflare cair, estiver mal configurada ou nem existir,
a leitura volta para o Firebase sozinha e ninguém percebe. O backup, a
recuperação de imagens perdidas e a exportação continuam lendo do
Firebase, que segue completo.

Enquanto a constante `CF_IMG_URL` no `index.html` estiver **vazia**
(como está agora), tudo isso fica desativado e o sistema se comporta
exatamente como antes. Ou seja: publicar esta versão não muda nada até
alguém fazer os passos abaixo.

> ⚠️ **Isto não substitui o upgrade para o Blaze.** O estouro da cota de
> download do Firebase (14,6 GB de 10 GB em agosto/2026) se resolve no
> painel do Firebase, com o botão "Fazer upgrade". São dois assuntos.

---

## Passo a passo — tudo pelo site, sem instalar nada

### 1. Criar a conta na Cloudflare

- Acesse https://dash.cloudflare.com e crie a conta (grátis).
- Essa mesma conta vai servir depois para os domínios e sites da empresa.

### 2. Ativar o R2 e criar o "bucket" (a pasta das imagens)

- No menu lateral, clique em **R2 Object Storage**.
- A Cloudflare pede um cartão para ativar o R2 (é para o caso de um dia
  passar da franquia — os primeiros 10 GB são grátis e o download é
  grátis sempre).
- Clique em **Create bucket** e crie um bucket chamado:

  ```
  liveops-imagens
  ```

  (esse nome exato — o resto das configurações pode ficar no padrão)

### 3. Criar o worker (o porteiro que recebe e entrega as imagens)

- No menu lateral, vá em **Workers & Pages** → **Create** →
  **Create Worker**.
- Dê o nome `liveops-imagens` e clique em **Deploy** (ele nasce com um
  código de exemplo — não importa).
- Clique em **Edit code**, apague tudo que estiver lá e cole o conteúdo
  inteiro do arquivo deste repositório:

  ```
  cloudflare/worker-imagens/worker.js
  ```

- Clique em **Deploy** de novo.

### 4. Ligar o worker ao bucket

- Volte para a tela do worker → aba **Settings** → **Bindings** →
  **Add** → **R2 bucket**.
- Preencha:
  - **Variable name**: `IMAGENS` (exatamente assim, maiúsculas)
  - **R2 bucket**: `liveops-imagens`
- Salve (e faça **Deploy** de novo se ele pedir).

### 5. Testar

Abra no navegador o endereço do worker + `/saude`:

```
https://liveops-imagens.SUACONTA.workers.dev/saude
```

Tem que aparecer só a palavra **ok**. (O endereço exato aparece na tela
do worker, em **Settings → Domains & Routes**.)

- Apareceu `ok` → publicação certa.
- Deu erro de `binding-IMAGENS-ausente` ao usar → o passo 4 ficou
  faltando ou o nome da variável não é `IMAGENS`.

### 6. Ligar no sistema

Com o worker no ar, o endereço dele precisa entrar no `index.html`, na
constante `CF_IMG_URL` (procure por esse nome; hoje está vazia):

```js
const CF_IMG_URL='https://liveops-imagens.SUACONTA.workers.dev';
```

O jeito mais simples: **mande o endereço para o Claude na sessão de
desenvolvimento e peça para preencher e publicar.** A partir da
publicação, toda imagem nova gravada no sistema já nasce com cópia no
R2, e as leituras passam a tentar o R2 primeiro.

### 7. Copiar as imagens que já existem

As fotos antigas continuam só no Firebase até serem copiadas. A cópia
roda no navegador de quem estiver logado (de preferência o master):

1. Abra o sistema e faça login normalmente.
2. Aperte **F12** → aba **Console**.
3. Digite e dê Enter:

   ```js
   migrarImagensParaCloudflare()
   ```

4. Acompanhe o progresso no próprio console. No final aparece um resumo:
   `X copiada(s), Y falha(s)…` — e um aviso na tela do sistema.

É só cópia: **nada é apagado do Firebase**. Pode rodar de novo quantas
vezes quiser (regravar a mesma imagem só sobrescreve a cópia igual).

---

## Como saber que está funcionando

- No painel da Cloudflare, o bucket `liveops-imagens` passa a listar os
  arquivos (Objects) conforme as imagens são gravadas/copiadas.
- No sistema, abra uma foto ampliada com o F12 na aba **Network**: a
  busca aparece indo para `...workers.dev/img/...` em vez do Firebase.

## Se a Cloudflare cair

Nada acontece com a operação: a gravação principal já é no Firebase e a
leitura volta para ele sozinha quando o R2 não responde. O pior caso é a
foto demorar uma fração de segundo a mais para abrir.

## Custos desta etapa

- **R2**: 10 GB grátis; depois US$ 0,015 por GB/mês. Download: grátis.
- **Worker**: 100.000 chamadas por dia grátis — o uso do LiveOps não
  chega perto disso.
- Na prática: **US$ 0/mês** por um bom tempo.

---

## As próximas etapas da migração (quando fizer sentido)

Esta é a etapa 1 de um caminho maior, sempre com o Firebase ligado até a
etapa estar provada:

| Etapa | O quê | Situação |
|---|---|---|
| 1 | Imagens no R2 (este documento) | **pronta no código** |
| 2 | Domínios e sites da empresa na Cloudflare (DNS + Pages) | quando quiser — independe do sistema |
| 3 | Robôs do n8n gravando via worker (em vez de direto no Firebase) | a desenhar |
| 4 | Dados e tempo real (Durable Objects + D1) | a mais trabalhosa — só com motivo forte |
| 5 | Login | por último |

Com os números de hoje (79 MB de dados, fatura projetada de ~US$ 5/mês
no Blaze), as etapas 4 e 5 não se pagam — estão aqui como mapa, não como
recomendação.
