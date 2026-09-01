# Permissões e tarefas — as duas garantias

Escrito em 01/09/2026, depois de as permissões voltarem sozinhas pela
enésima vez e de um dia inteiro de tarefas concluídas não chegar a
ninguém. Isto aqui não é uma explicação de código: é o contrato do
sistema, e o que precisa continuar verdade depois de qualquer alteração
futura.

---

## Garantia 1 — uma permissão só sai quando o master tirar

### Por que quebrava

A permissão era uma **lista de textos** dentro do usuário
(`perms: ['plataformas','envios']`). Onze caminhos diferentes deste
sistema conseguem escrever essa lista:

| # | Caminho | O que ele é |
|---|---|---|
| 1 | `togglePerm` | o clique do master — o único que é intenção |
| 2 | `patchUsers` | a semente dos quatro usuários da operação |
| 3 | `_expandirPermsFinas` | as migrações de abas novas |
| 4 | `_permsAplicarOficiais` | o nó oficial `suplelive/permissoes` |
| 5 | `_aplicarPermissoesOficiais` | o mesmo nó, chegando pela sala |
| 6 | `_gravarPermissoesDireto` | a gravação do clique |
| 7 | `_protegerPermissoes` | a guarda contra cópia velha |
| 8 | `criarUsuario` | usuário novo |
| 9 | `applyRemoteState` / `_aplicarPacoteDaNuvem` | o pacote de outra sessão |
| 10 | o login (`appState.users = cloudUsers`) | a leitura da nuvem |
| 11 | `loadLocal` | a cópia do navegador |

Dez desses onze são **cópias**. E com uma lista, cópia velha e recusa são
a mesma coisa — *"não está aqui"*. Qualquer cópia atrasada, vinda de
qualquer um desses caminhos, apagava a concessão sem querer. Cada
correção fechava um caminho e o décimo-segundo aparecia depois.

### A regra nova

A permissão passou a ser um **lançamento**, com hora e autor:

```js
permsLog: {
  tarefas: { v:true,  ts:1756742391000, por:'CM Andrade' },
  envios:  { v:false, ts:1756742402000, por:'CM Andrade' }
}
```

e `perms` virou só o resultado da leitura do livro.

A regra inteira: **para cada permissão vale o lançamento mais recente.**

A consequência é a garantia:

> Uma cópia que **não conhece** uma permissão não consegue tirá-la.
> Não trazer não é lançamento nenhum.
> Sair do livro exige um `v:false`, e `v:false` só nasce de um lugar:
> o clique do master em `togglePerm`.

Dar continua fácil. Tirar só acontece de propósito.

### O que isso significa na prática

- O master dá uma permissão. Nenhum login, nenhum pacote atrasado,
  nenhum nó oficial que ficou para trás desfaz aquilo.
- O master tira uma permissão. A recusa viaja com carimbo e vence
  qualquer cópia que ainda achava que a permissão existia.
- Duas cópias sem carimbo nenhum: as permissões **se somam**. Ninguém
  apaga ninguém por não saber.

### Onde está no código

- `_permsLivro`, `_permsAbsorver`, `_permsEfetivar`, `_permsFundirLivro`
- `_permsReconciliar` — a porta única por onde toda cópia de usuários passa
- `togglePerm` — o único produtor de recusa

Testes: `t-livro.js` (parte 1) e `t-permsync.js`.

---

## Garantia 2 — tarefa concluída não volta para "A Fazer"

### Por que quebrava

As quatro listas do dia — WhatsApp, Marketplaces, Pedidos, Anúncios —
viajam **dentro do pacote**, e o pacote sobe inteiro: a última sessão a
gravar substitui a lista das outras.

E não havia como decidir quem estava certo: o item guardava
`doneAt:"14:32"`, uma hora sem dia, que não serve para comparar duas
versões.

Havia ainda três outras formas de perder uma conclusão:

1. um pacote com o **dia anterior** chegava, a sessão achava que era a
   virada do dia, arquivava e zerava o quadro de hoje — publicando o
   quadro zerado por cima;
2. uma **migração de estrutura** (`data.tasks.whatsapp = initWpp()`)
   reconstruía o quadro do zero e jogava as conclusões fora junto; são
   oito lugares que fazem isso;
3. a sessão que não conseguia ler a nuvem virava fantasma e nunca
   publicava nada (ver `2026.09.01r`).

### A regra nova

Cada item ganhou `doneTs` (milissegundos), carimbado por comparação
dentro do `saveState` — e não dentro de cada botão, porque são doze
lugares que escrevem `done`, dois deles inline no `makeCompleteBtn`.

Na fusão, item a item:

- vale a marcação com o **carimbo mais novo**;
- sem carimbo dos dois lados, **concluído vence**.

> Não saber de uma conclusão nunca desfaz uma conclusão.
> Só um `doneTs` mais novo desmarca — e ele nasce de alguém clicando.

Mais as três proteções:

- **virada do dia**: se aqui já é hoje e o pacote traz ontem, o pacote é
  cópia velha e não vira dia nenhum;
- **reconstrução de estrutura**: `_preservarConclusoes` leva done/doneBy/
  doneAt/doneTs/execs para o quadro novo, nos oito pontos;
- **execuções** (tarefas com repetição) se somam, nunca se substituem.

### Onde está no código

- `_TAREFAS_DIARIAS`, `_tarefasItens`, `_carimbarTarefas`,
  `_tarefasAnotarVistas`, `_fundirTarefasDiarias`, `_preservarConclusoes`
- a guarda da virada do dia, no topo de `applyRemoteState`

Testes: `t-livro.js` (parte 2).

---

## O que NÃO fazer daqui para frente

1. **Não escrever `u.perms = <alguma lista>` em lugar nenhum.** A lista é
   resultado. Quem quiser mudar permissão escreve no livro e chama
   `_permsEfetivar`.
2. **Não substituir uma lista de tarefas do dia inteira** vinda de uma
   cópia. Se precisar, passe por `_fundirTarefasDiarias`.
3. **Não reconstruir um quadro** (`initWpp()` e companhia) sem envolver
   `_preservarConclusoes`.
4. **Não deixar gravação na nuvem sem retentativa e sem aviso.** O que
   falha calado vira um dia de trabalho perdido que ninguém percebe na
   hora.
