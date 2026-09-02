# Documentação do LiveOps

O LiveOps é o sistema de operações da Suplelive: pedidos de todos os
canais de venda, compras importadas dos EUA, estoque, devoluções,
atendimento e a rotina diária da equipe.

Esta pasta é a **especificação** do sistema — para quem vai programar,
para quem vai manter e para as IAs que trabalham no código. Ela não
descreve o que existe hoje por curiosidade histórica: descreve o que
precisa continuar verdade.

---

## Como esta pasta é organizada

```
docs/
├── README.md                  você está aqui — índice e convenções
├── banco/
│   ├── schema.sql             o esquema, tabela por tabela
│   └── decisoes.md            por que cada escolha, e o que ela evita
├── modulos/                   um documento por módulo do sistema
│   └── ...
└── (arquivos de integração: n8n, BaseLinker, Cloudflare)
```

### Um módulo, um documento

Cada módulo do sistema tem um documento com as mesmas cinco seções, na
mesma ordem. É o que permite ler qualquer um deles sem reaprender a
navegar:

1. **O que este módulo faz** — em duas frases, do ponto de vista de
   quem usa. Não do ponto de vista do código.
2. **Dados** — as tabelas envolvidas e o que cada campo significa
   quando o nome não basta.
3. **Invariantes** — o que precisa continuar verdade sempre. É a
   seção mais importante e a mais fácil de esquecer.
4. **Fluxos** — o passo a passo do que acontece, incluindo o que pode
   dar errado no meio.
5. **Histórico de defeitos** — o que já quebrou aqui e por quê.

A quinta seção existe porque este sistema já perdeu dados três vezes
pelo mesmo motivo com três roupas diferentes. Escrever o que quebrou é
o que impede a próxima pessoa — ou a próxima IA — de reabrir o buraco
achando que está limpando código morto.

### Módulos já escritos

| Módulo | Documento | Estado |
|---|---|---|
| Permissões e tarefas | [`permissoes-e-tarefas.md`](permissoes-e-tarefas.md) | escrito |
| Banco de dados | [`banco/schema.sql`](banco/schema.sql) | esquema do núcleo |
| Pedidos da Base | [`base-pedidos-whatsapp.md`](base-pedidos-whatsapp.md) | escrito |
| Estoque | [`base-estoque.md`](base-estoque.md) | escrito |
| Entrada de estoque | [`entrada-estoque.md`](entrada-estoque.md) | escrito |
| API REST | [`api-rest.md`](api-rest.md) | escrito |
| Cloudflare (dados, imagens, login, tempo real) | `cloudflare-*.md` | escrito |
| Compras | — | **a escrever** |
| Devoluções e atendimento | — | **a escrever** |
| WhatsLive | [`chatwoot-historico.md`](chatwoot-historico.md) | parcial |

---

## As três garantias

São as promessas que o sistema faz para a equipe. Qualquer alteração
que as quebre está errada, por mais elegante que pareça.

### 1. Uma permissão só sai quando o master tirar

Nem login, nem sincronização, nem cópia antiga de outro navegador
remove uma permissão concedida. Só o clique do master no Administrador.

**Como é garantido:** a permissão é uma linha em `permissoes`, com
`concedida` e carimbo de hora. Ausência não é revogação.

### 2. Tarefa concluída não volta para "A Fazer"

Quem concluiu continua constando como quem concluiu, e a conclusão não
é desfeita por nenhuma sincronização.

**Como é garantido:** a conclusão é uma linha em `rotina_execucoes`,
com autor e hora. Desfazer exige um `DELETE` explícito.

### 3. Nada some sem alguém mandar sumir

Registro que sai da tela sai porque uma pessoa clicou em Excluir.

**Como é garantido:** exclusão lógica (`excluido_em`) em toda tabela de
trabalho. Nada é apagado de verdade, e "sumiu" passa a ser uma pergunta
com resposta.

---

## Convenções do código

- **Português** nos nomes de tabela, coluna, função e variável. O
  sistema é operado em português e a tradução mental entre tela e
  código é uma fonte de erro que não paga nada.
- **Comentário explica o porquê, não o quê.** `// soma os itens` não
  ajuda ninguém; `// o frete entra rateado por peso, não por item —
  caixa pesada custa mais` ajuda.
- **Dinheiro em `numeric`**, nunca em ponto flutuante.
- **Data com fuso** (`timestamptz`), gravada em UTC. A tela mostra em
  horário de Brasília.
- **Toda escrita que pode falhar tem retentativa e aviso na tela.**
  Gravação que falha calada vira um dia de trabalho perdido que
  ninguém percebe na hora — já aconteceu.

## Segurança

- **O repositório é público.** Nenhuma chave, token ou senha em
  arquivo nenhum, nunca. Credenciais vivem no painel da Cloudflare, no
  n8n e nas variáveis de ambiente da Vercel.
- **Permissão se confere no servidor.** Esconder um botão na tela não
  é controle de acesso.
- **Identidade não viaja em dado de trabalho.** Foi assim que
  qualquer colaborador conseguia virar master até a v21 do worker.
