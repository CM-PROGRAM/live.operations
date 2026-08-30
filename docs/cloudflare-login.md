# Migração para a Cloudflare — Etapa 5: o login próprio

## A última amarra

Depois das etapas 1 a 4, o Firebase já não era mais necessário para
guardar imagem, guardar dado, avisar quem está online nem entregar o que
o n8n traz. Sobrava **uma** coisa: dizer quem é quem.

Era só por isso que ele não podia ser desligado. Sem o Firebase Auth,
o worker recusaria todo mundo — inclusive as fotos e o espelho.

Esta etapa tira essa última amarra.

## Ninguém redefine senha nenhuma

É a parte que importa saber antes de qualquer coisa: **para a equipe,
nada muda**. Cada pessoa entra com o usuário e a senha de sempre. No
primeiro login depois desta publicação, a senha dela passa a existir
também na Cloudflare — sozinha, sem aviso, sem redefinição, sem e-mail.

A senha em si não é guardada. Fica só o resultado de milhares de rodadas
de PBKDF2 sobre ela, com um sal sorteado por pessoa. De quem tivesse o
banco na mão, não se tira a senha de volta.

Quantas rodadas? A conta é cara de propósito — é isso que torna inviável
tentar senha por senha — mas o worker tem um teto de trabalho por
requisição, e ele muda com o plano. Em vez de eu chutar um número, o
worker **mede**: na primeira semeadura ele desce uma escada
(100.000 → 60.000 → 30.000 → 15.000 → 8.000) e fica com a primeira que o
runtime aceitar. O número que venceu é gravado **junto com cada senha**,
porque conferir depois é refazer exatamente a mesma conta. Sobe no
console, no login: `(60.000 voltas de PBKDF2)`.

Isso também deixa a porta aberta para subir o número depois — trocando de
plano, por exemplo — sem invalidar nenhuma senha já guardada: cada linha
lembra a sua.

## Como o login funciona agora

1. A pessoa digita usuário e senha.
2. O sistema tenta o **Firebase primeiro**. Entrando, semeia a senha no
   cofre do worker e segue a sessão normal.
3. Se o Firebase recusar **por credencial errada**, a resposta é "senha
   incorreta" e acabou — o cofre novo nem é consultado.
4. Só quando a falha **não é de credencial** (Firebase fora do ar, rede
   caída, cota estourada) o sistema tenta entrar pelo cofre da Cloudflare.

Essa ordem não é detalhe. Invertê-la traria dois problemas de uma vez: a
gravação dupla ainda passa pelo Firebase e exige a sessão dele
autenticada — entrar só pelo cofre deixaria o sistema gravando pela
metade, em silêncio; e uma senha trocada no Firebase precisa prevalecer,
em vez de a cópia antiga continuar abrindo a porta.

O caminho 4 é o que sobra quando o Firebase for desligado. Hoje ele já
serve de rede de segurança: se o Firebase cair no meio do expediente, a
equipe continua entrando.

## Semear é sempre a PRÓPRIA senha

A configuração do Firebase está à vista na página — qualquer pessoa
consegue criar uma conta contra o projeto e obter um token válido. Por
isso "ter um token" nunca foi o mesmo que "trabalhar aqui", e o worker
confere três coisas antes de guardar uma senha:

- **de quem é o crachá**: com o crachá do próprio worker, ele já diz o
  nome — trocar a própria senha, sim; a de outro, não;
- **a conta está na lista de aprovados** (`autorizados`, a mesma lista
  que o master mantém e que já vive no espelho) — conta criada por fora
  não semeia nada;
- **quem chegou primeiro fica com o nome**: o primeiro a entrar como
  `master` é o master, porque só ele tem a senha do master. Dali em
  diante aquela conta é dele, e outro usuário não a sobrescreve.

Sem essas três, bastaria estar logado para escolher a senha do master — e
entrar como ele no dia em que o Firebase saísse.

---

## Parte 1 — na Cloudflare

### 1. Colar o worker `v13`

Worker `liveops-imagens` → **Edit code** → apagar tudo → colar
`cloudflare/worker-imagens/worker.js` → **Deploy**.

Conferir, e conferir de verdade — abrir no navegador:

```
https://liveops-imagens.carlosmagnoav94.workers.dev/saude
```

Precisa responder **`ok v13`**. Se responder outra coisa, o que está no ar
é uma cópia antiga: a colagem não pegou, e vale repetir antes de seguir.

### 2. Criar o segredo `SEGREDO_SESSAO` (recomendado)

Worker → **Settings** → **Variables and Secrets** → **Add** → tipo
**Secret**:

| Nome | Valor |
|---|---|
| `SEGREDO_SESSAO` | uma senha longa inventada por você (30+ caracteres, letras e números) — não precisa decorar, ninguém a digita nunca |

É com ela que os crachás do sistema são assinados. Sem ela o worker usa
a `CHAVE_ROBO` como reserva e funciona igual; separar as duas é melhor
porque a `CHAVE_ROBO` circula pelo n8n e um dia será trocada.

> Trocar o `SEGREDO_SESSAO` depois derruba as sessões abertas: todo mundo
> faz login de novo, e só. Nenhuma senha se perde.

### 3. A tabela nasce sozinha

Nada de SQL. Na primeira vez que alguém entrar, o worker cria a tabela
`senhas` no banco `liveops-dados` — já completa, com todas as colunas.

Ela nasce completa de propósito. A `v11` acrescentava colunas a uma
tabela que já existia, por `ALTER TABLE`, com o erro engolido por um
`catch` — "a coluna já estava lá" era o caso esperado. Quando o `ALTER`
não pegou, o `catch` apagou o motivo e a semeadura passou a estourar como
`falha-no-worker`, sem dizer nada. Uma tabela nova, com outro nome, não
tem esse caminho; e a antiga (`usuarios`), que guardava hash de senha e
não serve mais, é apagada — segredo parado sem dono não fica.

---

## Parte 2 — no sistema

Publicada a versão `2026.08.30a`, cada pessoa só precisa **entrar uma
vez**. É isso. Quem quiser ver acontecendo: no console (F12), aparece
`[auth] senha registrada também na Cloudflare`.

Se em vez disso aparecer `[auth][cf] a senha NÃO foi registrada na
Cloudflare:` seguido de um motivo, vale ler agora e não depois:

| Motivo | O que é | O que fazer |
|---|---|---|
| `sem-autorizacao` | a conta não está na lista de aprovados | o master aprova a pessoa como sempre; ela entra de novo |
| `espelho-sem-autorizados` | a lista de aprovados ainda não foi copiada para a Cloudflare | o master roda `migrarDadosParaCloudflare()` uma vez; ninguém semeia até isso |
| `chave-de-outra-pessoa` | aquele nome de usuário já é de outra conta do Firebase | conta refeita: `soltar` o nome (abaixo) e entrar de novo |
| `sem-segredo-de-sessao` | falta `SEGREDO_SESSAO` **e** `CHAVE_ROBO` no worker | criar o segredo da Parte 1 |
| `sem-login` | o crachá venceu no meio do caminho | recarregar e entrar de novo |
| `falha-no-worker` | quebrou dentro do worker | a mensagem vem com o `detalhe` e a linha onde quebrou — mandar as três coisas |

---

## A pergunta que decide o desligamento

Antes de desligar o Firebase, uma coisa precisa ser **verdade**, não
provável: todo mundo já entrou uma vez. No console do sistema:

```js
conferirSenhasNaNuvem()
```

Sai uma tabela com cada pessoa ativa e a data em que a senha dela chegou
à Cloudflare — ou `AINDA NÃO`. E o veredito:

- `✓ todo mundo já tem senha na Cloudflare — o Firebase pode ser desligado`
- `⚠ N pessoa(s) ainda sem senha…` com os nomes

**Enquanto houver um `AINDA NÃO`, desligar o Firebase deixa essa pessoa
do lado de fora.** Não há pressa que compense isso: basta pedir a ela que
entre uma vez.

### Soltar um nome (o caso raro)

Se a conta do Firebase de alguém foi refeita, o nome fica preso à conta
antiga. Para liberá-lo (só com a chave do robô, que só o master tem):

```
curl -X POST "https://liveops-imagens.carlosmagnoav94.workers.dev/auth/soltar?chave=fulano" \
  -H "X-LiveOps-Chave: SUA_CHAVE_ROBO"
```

No próximo login, o nome é reivindicado pela conta nova.

---

## O desligamento, passo a passo

Só depois do `✓` acima. Nesta ordem, e um passo por vez:

1. **Todo mundo em `preferir`.** Hoje a leitura pela Cloudflare é ligada
   por navegador. Vira padrão de todos trocando, no `index.html`,
   `CF_LEITURA_PADRAO='off'` por `'preferir'`, e publicando. A partir daí
   o Firebase deixa de ser lido — o download some antes mesmo do
   desligamento.
2. **Uma semana de convivência.** Tudo continua sendo copiado para o
   Firebase. É a rede de segurança: qualquer surpresa, `cfLeitura('off')`
   em um navegador devolve o sistema de antes, na hora.
3. **Fechar a porta do Firebase no worker.** Em `conferirTokenBruto`,
   apagar o trecho que aceita o crachá do Firebase (fica só
   `_conferirTokenProprio`). É o gesto que torna o desligamento
   irreversível — por isso vem depois do `✓`, não antes.
4. **Parar o repasse.** Em `repassarAoFirebase`, devolver sem fazer nada.
   Nenhum fluxo do n8n é tocado: eles falam com o worker desde a etapa 3.
5. **Desligar a gravação dupla no sistema**, apagando as escritas para o
   Firebase — que a essa altura não são mais lidas por ninguém.
6. **Um último backup do Firebase** (Realtime Database → Exportar JSON),
   guardado fora dele.
7. **Desligar o Firebase.** Faturamento de volta ao Spark e, se quiser,
   o banco apagado.

Entre o passo 3 e o 7 não existe volta simples. Do 1 ao 2, existe — e é
por isso que eles são os demorados.

## Situação das etapas

| Etapa | O quê | Situação |
|---|---|---|
| 1 | Imagens no R2 | ✅ em produção |
| 2 | Espelho de todos os dados | ✅ em produção |
| 3 | Robôs do n8n gravando pelo worker | ✅ em produção (4 fluxos migrados; 4 parados, a migrar antes de religar) |
| 4 | Sala de tempo real e leitura pela Cloudflare | ✅ no ar, ligada por navegador |
| 5 | Login próprio (este documento) | ✅ no código — falta cada pessoa entrar uma vez |
| 6 | Desligar o Firebase | os 7 passos acima |
