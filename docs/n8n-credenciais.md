# Credenciais do n8n — o que fica e o que sai

Três credenciais, e só. Toda vez que alguém importa um fluxo, o n8n cria uma
credencial vazia com nome genérico (`Header Auth account`, `Google Service
Account account`) para o campo não ficar em branco. Elas se acumulam, e o
estrago não é estético: a lista fica com dois nomes parecidos, alguém escolhe
o vazio, e o erro que aparece três nós adiante é "401 não autenticado" — que
não diz nada sobre credencial errada. Foi o que nos custou tempo no Melhor
Envio e de novo na Base.

---

## As três que ficam

| Nome | Tipo | Conteúdo | Usada em |
|---|---|---|---|
| **Base (BaseLinker)** | Header Auth | Name `X-BLToken` · Value = token da conta | `Status da Base`, `Pedidos da Base`, `Origens de venda` |
| **Melhor Envio** | Header Auth | Name `Authorization` · Value `Bearer <token>` | `Melhor Envio · rastreio`, `Melhor Envio · achar pedido` |
| **Firebase (conta de serviço)** | Google Service Account API | e-mail + chave privada da conta `firebase-adminsdk-fbsvc@suplelive-8a700` | `Ler Live Track`, `Gravar no LiveOps` (os dois fluxos) |

Na credencial do Firebase, dois detalhes que já nos morderam:

- **Configurado para uso no nó de requisição HTTP**: ligado.
- **Âmbito(s)**, separados por **vírgula, sem espaço**:
  ```
  https://www.googleapis.com/auth/firebase.database,https://www.googleapis.com/auth/userinfo.email
  ```
  Com espaço no lugar da vírgula, o n8n manda tudo como um escopo só, o token
  sai sem permissão e o Firebase responde "Permissão negada".

---

## As que saem

Em **Visão geral → Credenciais**, apague o que tiver nome genérico e estiver
vazio:

- `Header Auth account`
- `Header Auth account 2` (se ainda existir com esse nome)
- `Google Service Account account`

Antes de apagar, confira que nenhum nó aponta para ela: abra os fluxos e veja
se todos os campos de credencial mostram um dos três nomes da tabela acima.
Se um nó estiver apontando para a vazia, troque **antes** — apagar uma
credencial em uso deixa o nó quebrado sem avisar na hora.

---

## O que não é credencial (e por que)

A **senha do Manda Bem** está escrita dentro do nó `Login Manda Bem`, no corpo
do POST. O n8n não sabe injetar valor de credencial dentro do corpo de uma
requisição — credencial ali só serve para cabeçalho ou autenticação padrão.

A consequência prática: **ao exportar esse fluxo, a senha vai junto**. Antes de
mandar o JSON para alguém, apague o campo. E vale trocar aquela senha por uma
forte: ela dá acesso ao painel que emite etiqueta e movimenta frete.

---

## Regra para as próximas importações

Ao importar um fluxo, o n8n mostra os nomes das credenciais mas **não as
vincula sozinho** — o vínculo é por identificador interno, e o arquivo vem sem
ele de propósito (token não viaja em arquivo). Então, depois de importar:

1. Abra cada nó que tenha autenticação.
2. **Selecione na lista** a credencial certa — nunca "Create new credential",
   que é o que cria as vazias.
3. Se você criou uma vazia sem querer, apague na hora, enquanto lembra.
