/* Serviço de tarefas contra um Postgres de verdade (TESTE_DATABASE_URL).
   Sem a variável, os testes são pulados — não há banco falso aqui. */
import { after, before, test } from "node:test"
import assert from "node:assert/strict"

const url = process.env.TESTE_DATABASE_URL
const opcoes = { skip: url ? false : "sem TESTE_DATABASE_URL" }
process.env.DATABASE_URL = url

let s: typeof import("../src/backend/tarefas/servico")
let db: typeof import("../src/backend/db")
const autor = { id: 0, chave: "teste", nome: "Teste", email: "", master: true, cor: "", iniciais: "TE", permissoes: [] }

before(async () => {
  if (!url) return
  s = await import("../src/backend/tarefas/servico")
  db = await import("../src/backend/db")
  await db.consultar("TRUNCATE tarefas, comentarios, auditoria RESTART IDENTITY CASCADE")
  // Pessoas de teste; o banco de testes começa só com o esquema
  await db.consultar(
    `INSERT INTO usuarios (chave, nome, email, master, iniciais) VALUES
       ('teste', 'Teste', 'teste@exemplo.com', true, 'TE'),
       ('ana', 'Ana', 'ana@exemplo.com', false, 'AN'),
       ('bruno', 'Bruno', 'bruno@exemplo.com', false, 'BR')
     ON CONFLICT (chave) DO NOTHING`
  )
  const [u] = await db.consultar<{ id: number }>("SELECT id::int AS id FROM usuarios WHERE chave = 'teste'")
  autor.id = u.id
})

test("criar, concluir, reabrir: tudo auditado com autor", opcoes, async () => {
  const id = await s.criarTarefa({ titulo: "Conferir estoque", descricao: "", prioridade: "alta", vencimento: null, responsaveis: ["ana", "bruno"], area: "diarias" }, autor)
  await s.editarTarefa(id, { status: "concluida" }, autor)
  let t = await s.obterTarefa(id)
  assert.equal(t?.status, "concluida")
  assert.equal(t?.concluido_por, "Teste")
  assert.ok(t?.concluido_em)
  assert.deepEqual(t?.responsaveis.map((r) => r.chave), ["ana", "bruno"])

  await s.editarTarefa(id, { status: "aberta" }, autor)
  t = await s.obterTarefa(id)
  assert.equal(t?.concluido_em, null)
  const eventos = t!.historico.map((h) => `${h.evento}:${h.campo ?? ""}:${h.para ?? ""}`)
  assert.deepEqual(eventos, ["editado:status:aberta", "editado:status:concluida", "criado::"])
  assert.ok(t!.historico.every((h) => h.autor === "Teste"))
})

test("editar sem mudar nada não gera auditoria", opcoes, async () => {
  // Uma data sempre futura: com data fixa o teste vira "atrasada" sozinho
  const daquiAUmMes = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)
  const id = await s.criarTarefa({ titulo: "X", descricao: "", prioridade: "normal", vencimento: daquiAUmMes, responsaveis: ["ana"], area: "diarias" }, autor)
  await s.editarTarefa(id, { titulo: "X", prioridade: "normal", vencimento: daquiAUmMes, responsaveis: ["ana"] }, autor)
  assert.equal((await s.obterTarefa(id))!.historico.length, 1)
})

test("excluir é lógico: some da lista, fica no banco, com quem excluiu", opcoes, async () => {
  const id = await s.criarTarefa({ titulo: "Apagar", descricao: "", prioridade: "normal", vencimento: null, responsaveis: ["bruno"], area: "diarias" }, autor)
  await s.excluirTarefa(id, autor)
  assert.equal(await s.obterTarefa(id), null)
  assert.ok(!(await s.listarTarefas({ status: "todas" })).some((t) => t.id === id))
  const [linha] = await db.consultar<{ excluido: boolean }>("SELECT excluido_em IS NOT NULL AS excluido FROM tarefas WHERE id = $1", [id])
  assert.equal(linha.excluido, true)
  const [a] = await db.consultar<{ evento: string }>("SELECT evento FROM auditoria WHERE entidade_id = $1 ORDER BY id DESC LIMIT 1", [id])
  assert.equal(a.evento, "excluido")
  await assert.rejects(s.excluirTarefa(id, autor), /não encontrada/)
})

test("atrasada usa o dia de Brasília e filtros combinam", opcoes, async () => {
  const ontem = new Date(Date.now() - 86400_000 - 3 * 3600_000).toISOString().slice(0, 10)
  const id = await s.criarTarefa({ titulo: "Vencida urgente", descricao: "", prioridade: "urgente", vencimento: ontem, responsaveis: ["bruno"], area: "diarias" }, autor)
  const atrasadas = await s.listarTarefas({ status: "atrasada", responsavel: "bruno" })
  assert.deepEqual(atrasadas.map((t) => t.id), [id])
  assert.equal(atrasadas[0].atrasada, true)
  assert.equal((await s.listarTarefas({ status: "todas", busca: "urgente" }))[0].id, id)
  const c = await s.contarPorStatus()
  assert.equal(c.atrasada, 1)
  assert.equal(c.todas, c.aberta + c.andamento + c.concluida + c.finalizada)
})

test("responsável desconhecido é recusado sem deixar lixo", opcoes, async () => {
  const antes = (await s.contarPorStatus()).todas
  await assert.rejects(s.criarTarefa({ titulo: "Y", descricao: "", prioridade: "normal", vencimento: null, responsaveis: ["ninguem"], area: "diarias" }, autor), /Responsável desconhecido/)
  assert.equal((await s.contarPorStatus()).todas, antes)
})

test("área: filtra, conta as abertas e a criação respeita a escolhida", opcoes, async () => {
  const id = await s.criarTarefa({ titulo: "Revisar loja", descricao: "", prioridade: "normal", vencimento: null, responsaveis: ["ana"], area: "marketplaces" }, autor)
  const lista = await s.listarTarefas({ status: "todas", area: "marketplaces" })
  assert.deepEqual(lista.map((t) => t.id), [id])
  assert.equal(lista[0].area, "marketplaces")
  assert.equal((await s.abertasPorArea()).marketplaces, 1)
  await s.editarTarefa(id, { status: "concluida" }, autor)
  assert.equal((await s.abertasPorArea()).marketplaces, undefined)
})

test("quadro: concluída antiga some, recente fica, aberta antiga fica", opcoes, async () => {
  const antiga = await s.criarTarefa({ titulo: "Concluída há um mês", descricao: "", prioridade: "normal", vencimento: null, responsaveis: ["ana"], area: "financeiro" }, autor)
  const recente = await s.criarTarefa({ titulo: "Concluída hoje", descricao: "", prioridade: "normal", vencimento: null, responsaveis: ["ana"], area: "financeiro" }, autor)
  const aberta = await s.criarTarefa({ titulo: "Aberta há um mês", descricao: "", prioridade: "normal", vencimento: null, responsaveis: ["ana"], area: "financeiro" }, autor)
  await s.editarTarefa(antiga, { status: "concluida" }, autor)
  await s.editarTarefa(recente, { status: "concluida" }, autor)
  await db.consultar("UPDATE tarefas SET concluido_em = now() - interval '30 days' WHERE id = $1", [antiga])
  await db.consultar("UPDATE tarefas SET criado_em = now() - interval '30 days' WHERE id = $1", [aberta])
  const quadro = (await s.listarTarefas({ status: "todas", area: "financeiro" }, { quadro: true })).map((t) => t.id).sort()
  assert.deepEqual(quadro, [recente, aberta].sort())
  const tudo = (await s.listarTarefas({ status: "todas", area: "financeiro" })).map((t) => t.id)
  assert.ok(tudo.includes(antiga)) // fora do quadro ela continua existindo
})

test("comentários ficam em ordem e com autor", opcoes, async () => {
  const id = await s.criarTarefa({ titulo: "Com conversa", descricao: "", prioridade: "normal", vencimento: null, responsaveis: ["ana"], area: "diarias" }, autor)
  await s.comentarTarefa(id, "primeiro", autor)
  await s.comentarTarefa(id, "segundo", autor)
  const t = await s.obterTarefa(id)
  assert.deepEqual(t!.comentariosLista.map((c) => c.texto), ["primeiro", "segundo"])
  assert.equal(t!.comentarios, 2)
})

after(async () => { if (url) await db.encerrarConexoes() })
