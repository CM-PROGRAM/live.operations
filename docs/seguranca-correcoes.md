# Correções da auditoria de segurança — 31/08/2026

Aplicadas no worker **v16** e no LiveOps **2026.08.31o**.

## A cadeia crítica, fechada

Três buracos que só juntos eram exploráveis — e é assim que precisavam
ser fechados. O caminho completo era: **criar conta na tela de login →
entrar no worker com o token dela → gravar o próprio uid em
`autorizados` → virar gente de casa.**

### 1. A tela de login criava conta (achado 3)

`_autenticarNoFirebase` tentava `createUserWithEmailAndPassword` quando o
login falhava. A intenção era separar "conta não existe" de "senha
errada" — o Firebase novo devolve o mesmo código para os dois.

Essa distinção **não deve existir**: separá-la é enumeração de usuário,
que também é falha. Os dois problemas somem com a mesma decisão: não
separar. Agora a falha de credencial simplesmente recusa. Conta nova é
ato do master, no painel.

> **Falta no console do Firebase:** *Authentication → Settings →* desligar
> *Enable create (sign-up)* do provedor E-mail/senha. Sem isso a API
> pública continua criando contas mesmo com o cliente corrigido — o
> cliente nunca é o portão. Depois, apagar do Firebase Auth as contas que
> não estiverem em `autorizados`.

### 2. O worker aceitava qualquer conta do projeto (achado 1)

`conferirToken()` conferia assinatura, `aud`, `iss` e `exp` — tudo certo
do ponto de vista criptográfico. Não conferia se aquele `sub` trabalha
aqui. A resposta já existia (`_autorizadoNoEspelho`), mas só `/auth/semear`
a usava.

Agora existe `conferirTokenAutorizado()`, e ela guarda os quatro portões:
o de dados, o WebSocket da sala, o `/auth/semeados` e o `_portadorDaApi`.
O crachá emitido pelo próprio worker (`iss:'liveops'`) passa direto — ele
só nasce de uma senha semeada contra essa mesma lista.

### 3. Escrita liberada em qualquer coleção (achado 2)

`/dados/lote` não distinguia gravar o próprio trabalho de gravar **quem eu
sou**. Um POST de uma linha na coleção `autorizados` promovia o autor.

```js
const COLECOES_PROTEGIDAS = new Set(['autorizados','usuarios','users','permissoes','senhas','forceLogout']);
```

Gravar nelas exige o crachá do master. O robô não é afetado: ele entra por
`/robo/`, com portão próprio.

## As demais

| # | Achado | O que foi feito |
|---|---|---|
| 4 | Login sem limite de tentativas | Teto de 8/min por conta **e** por IP, aplicado na **porta** de `atenderAuth` — antes do binding, da tabela e do PBKDF2. Colocado depois, cada tentativa ainda custava trabalho de banco. |
| 5 | XSS armazenado | `esc()` global no primeiro bloco de script (disponível nos onze), escapando também a **aspa simples** — é com ela que quase todo `onclick` do sistema é escrito. Aplicado no card do Kanban e em 13 outros campos livres. `_iniEsc` agora delega para ele. |
| 6 | Erro do `/auth/` devolvia a pilha | Detalhe vai para `console.error` (Workers Logs); a resposta leva só o código. Mesma coisa em `/robo/` e `/api/`. |
| 7 | CORS `*` | Lista de origens, com `Vary: Origin`. Decidido **na saída**, em `_comCors`, e não numa global lida por `resposta()` — o isolate atende vários pedidos ao mesmo tempo, e uma global vazaria a origem de um na resposta de outro. |
| 10 | `/dados/resumo` e `/lista` | Só o master. `/lista` percorre até 50 mil chaves do R2 — era um laço caro que qualquer sessão disparava. |

## ⚠️ Antes de publicar o worker v16

A checagem nova depende da coleção `autorizados` estar no espelho. Se ela
estiver vazia, **ninguém que usa token do Firebase entra** (o master, pelo
crachá próprio, continua entrando).

```
GET /dados/colecao?nome=autorizados
```

Veio populada → publique. Veio vazia → popule primeiro. O worker grita
`[auth] a colecao autorizados esta VAZIA no espelho` no log se acontecer.

## Ordem de implantação

1. Desligar o cadastro aberto no console do Firebase
2. Publicar o `index.html` (**2026.08.31o**)
3. Conferir `autorizados` no espelho
4. Publicar o worker (**v16**)
5. Limpar do Firebase Auth as contas fora da lista

## O que ficou em aberto

- **Regras do Realtime Database** — não estão no repositório. Se
  estiverem em `auth != null`, existe um segundo caminho que ignora o
  worker inteiro, e a conta criada pela tela de login servia para ele
  também. Vale copiar o JSON das regras e revisar.
- **Domínio próprio no worker** — enquanto ele responder em
  `*.workers.dev`, WAF e rate limiting da Cloudflare não se aplicam. O
  teto do achado 4 é hoje a única camada; com domínio próprio ele vira a
  segunda.
- **Repositório público** — `docs/` é o mapa da arquitetura. Nenhum
  segredo foi commitado em 679 commits (isso a auditoria confirmou), mas o
  mapa acelera qualquer sondagem.
- **CSP** — GitHub Pages não deixa configurar cabeçalho. Fica pendente até
  a hospedagem mudar; o worker já manda `X-Content-Type-Options` e
  `Referrer-Policy` nas respostas dele.
- **As outras ~400 ocorrências de `innerHTML`** — a maioria monta HTML
  fixo. A regra para o código novo: toda interpolação de campo que veio do
  banco ou de formulário passa por `esc()`.
