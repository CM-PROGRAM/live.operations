# Migração para a Cloudflare — Etapa 2: espelho de todos os dados

## O que esta etapa faz (e o que ela NÃO faz)

Tudo que o sistema grava no Firebase passa a ganhar uma **cópia
automática na Cloudflare**: os registros (tarefas, pedidos, estoque,
vendas, logs, arquivo permanente…) vão para um banco **D1** e o pacote
de estado vai para o R2 — pela rota `/dados` do **mesmo worker** da
etapa 1. Além do espelho contínuo, uma função de cópia única
(`migrarDadosParaCloudflare()`) traz para cá tudo o que já existe.

**Nada do Firebase é desligado.** O sistema continua lendo e gravando
no Firebase como sempre; a Cloudflare recebe segunda via de tudo. Se o
espelho falhar, aparece um aviso no console e a operação segue normal.
Enquanto a constante `CF_DADOS_ATIVO` no `index.html` estiver `false`
(como está), o espelho fica desligado e o sistema não muda em nada.

O que fica de fora do espelho, de propósito:

- **imagens** — já têm caminho próprio (etapa 1, R2);
- **backups diários** — são cópias do estado, que o espelho contínuo já
  cobre com dado mais fresco;
- **presence / forceLogout** — informação passageira por natureza.

Os ramos leves sem espelho contínuo (autorizados, solicitações,
permissões, inbox, activity) entram na cópia única — rodá-la de novo, de
tempos em tempos, atualiza essas cópias. O coração da operação (estado,
coleções `reg/*`, logs, arquivo) tem espelho contínuo em tempo real.

---

## Passo a passo — tudo pelo site

### 1. Criar o banco D1

- Menu lateral → **Storage & databases** → **D1 SQL Database** →
  **Create database**.
- Nome, exatamente:

  ```
  liveops-dados
  ```

- Localização no padrão → criar. (Não precisa criar tabela nenhuma — o
  worker cria sozinho no primeiro uso.)

### 2. Ligar o banco ao worker

- **Compute (Workers & Pages)** → worker **liveops-imagens** →
  **Settings** → **Bindings** → **Add** → **D1 database**.
- **Variable name**: `DADOS` (maiúsculas, exatamente assim)
- **D1 database**: `liveops-dados` → salvar.

### 3. Atualizar o código do worker

O worker ganhou as rotas `/dados` nesta etapa — é preciso colar a
versão nova (o mesmo arquivo `cloudflare/worker-imagens/worker.js` do
repositório, já atualizado):

- No worker → **Edit code** → apagar tudo → colar o conteúdo novo →
  **Deploy**.

### 4. Testar

- `https://liveops-imagens.SUACONTA.workers.dev/saude` → deve seguir
  respondendo **ok** (garante que a colagem não quebrou nada).

### 5. Ligar o espelho no sistema

Avise o Claude na sessão de desenvolvimento: ele muda
`CF_DADOS_ATIVO` para `true`, publica, e a partir daí toda gravação já
sai espelhada.

### 6. Copiar o que já existe

Logado no sistema (de preferência o master): **F12 → Console** →

```js
migrarDadosParaCloudflare()
```

Acompanhe o progresso ramo a ramo no console; no final aparece um
resumo (`X pacote(s), Y registro(s) copiado(s)…`). Só copia — não apaga
nem muda nada no Firebase. Pode rodar de novo quando quiser.

### 7. Conferir o espelho

No console do sistema:

```js
_cfDadosReq('resumo').then(r=>r.json()).then(r=>{console.table(r.colecoes);console.table(r.pacotes);})
```

Mostra quantos registros existem por coleção no banco da Cloudflare e
os pacotes guardados. Dá para comparar com o que se vê no Firebase.

---

## Custos desta etapa

- **D1 no plano grátis**: 500 MB de banco, 5 milhões de linhas lidas e
  100 mil gravadas por dia — dá para começar e validar o espelho.
- **Plano de US$ 5/mês (Workers Paid)**: sobe o banco para 5 GB — vale
  assinar **quando o histórico da Base/Bling for entrar** (etapa 3), ou
  se o espelho esbarrar no limite diário de gravações.
- O pacote de estado vai para o R2 (já ativo), sem custo extra.

## As próximas etapas

| Etapa | O quê | Situação |
|---|---|---|
| 1 | Imagens no R2 | ✅ publicada |
| 2 | Espelho de todos os dados (este documento) | **pronta no código** |
| 3 | Robôs do n8n gravando na Cloudflare + histórico Base/Bling no D1 | a desenhar |
| 4 | Tempo real (Durable Objects) — o sistema passa a LER daqui | a maior |
| 5 | Login próprio e aposentadoria do Firebase | última |
