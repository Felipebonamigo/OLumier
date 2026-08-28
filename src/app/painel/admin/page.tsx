import type { Metadata } from "next";
import Link from "next/link";
import { formatarBytes } from "@/lib/tenants";
import { exigirAdmin, metadataDeAdmin } from "@/lib/portao-admin";
import {
  panoramaDosEstudios,
  crescimentoMensal,
  entregaRecente,
  eventosRecentes,
} from "@/lib/admin";
import {
  resumoDaPlataforma,
  trialsVencendo,
  trialsVencidos,
  precoMensalDoEstudio,
  mensalEquivalenteCentavos,
} from "@/lib/metricas-admin";
import { planoPorId, formatarReais, cicloDe, GB } from "@/config/planos";
import { quotaEfetivaBytes } from "@/config/trial";
import {
  Cartao,
  Bloco,
  Situacao,
  Barra,
  data,
  dataHora,
  porcento,
} from "@/components/admin-pecas";

export async function generateMetadata(): Promise<Metadata> {
  return metadataDeAdmin("Administração");
}

export const dynamic = "force-dynamic";

/**
 * O PAINEL DE ADMINISTRAÇÃO.
 *
 * Uma página, três perguntas, nesta ordem — porque é a ordem em que elas
 * importam para quem abre:
 *
 *   1. O negócio se paga?          (dinheiro: entra, sai, sobra)
 *   2. Está crescendo, e para onde? (contas, espaço, entrega, meses)
 *   3. Quem precisa de mim hoje?    (alertas, e a lista de todo mundo)
 *
 * SÓ LEITURA. Não há um botão nesta página que mude coisa alguma — nem plano,
 * nem conta, nem galeria. É decisão, não limitação técnica: o administrador é a
 * única pessoa do sistema sem ninguém acima para desfazer o engano dele, e uma
 * tela que mostra 163 estúdios com um botão de apagar em cada linha é um
 * acidente esperando o dia cansado. O que precisar mudar, muda pelo caminho
 * normal — que deixa rastro na auditoria com o nome de quem fez.
 */
export default async function AdminPage() {
  await exigirAdmin();

  const [estudios, meses, entrega, eventos] = await Promise.all([
    panoramaDosEstudios(),
    crescimentoMensal(12),
    entregaRecente(30),
    /*
     * OITO, e não quarenta. Uma limpeza de galeria despeja trinta
     * `media.apagada` no mesmo minuto: com quarenta linhas, o painel terminava
     * com meia tela da mesma frase repetida, e o evento que importava ficava
     * fora dela. O que sai daqui não some — está em /painel/admin/eventos, com
     * filtro por ação, estúdio e período.
     */
    eventosRecentes(8),
  ]);

  const agora = new Date();
  const r = resumoDaPlataforma(estudios, agora);

  /*
   * Quanto cada pagante contribui, em média, depois do custo do que ele guarda.
   * É o número que responde "faltam quantos clientes" — e sem pagante nenhum a
   * pergunta não tem resposta, então não se inventa uma.
   */
  const contribuicaoPorPagante =
    r.porStatus.ativo === 0 ? null : Math.round(r.margemMensalCentavos / r.porStatus.ativo);
  const faltamClientes =
    r.resultadoMensalCentavos >= 0 || !contribuicaoPorPagante || contribuicaoPorPagante <= 0
      ? null
      : Math.ceil(-r.resultadoMensalCentavos / contribuicaoPorPagante);

  const vencendo = trialsVencendo(estudios, 7, agora);
  const vencidos = trialsVencidos(estudios, agora);
  const semDocumento = estudios.filter(
    (e) => !e.cpf_cnpj && !e.tem_assinatura && e.status !== "cancelado",
  );
  const apertados = estudios.filter((e) => {
    const quota = quotaEfetivaBytes(e);
    if (quota === BigInt(0)) return false;
    const usado = BigInt(e.bytes_no_ar) + BigInt(e.bytes_no_cofre);
    return usado * BigInt(100) > quota * BigInt(85);
  });
  const enviaramSemAbrir = estudios.filter((e) => e.medias > 0 && !e.ultimo_acesso);

  const totalGalerias = estudios.reduce((s, e) => s + e.galerias, 0);
  const totalPublicadas = estudios.reduce((s, e) => s + e.publicadas, 0);
  const totalFotos = estudios.reduce((s, e) => s + e.fotos, 0);
  const totalVideos = estudios.reduce((s, e) => s + e.videos, 0);
  const totalFavoritas = estudios.reduce((s, e) => s + e.favoritas, 0);

  /* O maior mês manda na escala das barras: escala fixa achataria tudo no dia
     em que um mês grande chegasse, e ninguém repara numa barra que encolheu. */
  const tetoCadastros = Math.max(1, ...meses.map((m) => m.cadastros));
  const tetoBytes = Math.max(1, ...meses.map((m) => Number(m.bytes_enviados)));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/painel" className="text-sm text-texto-soft hover:text-texto">
        ← Galerias
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight">Administração</h1>
      <p className="mt-1 text-sm text-texto-soft">
        A plataforma inteira. Só leitura — nada nesta página altera nada.
      </p>

      {/* ── 1. DINHEIRO ───────────────────────────────────────────────── */}
      <Bloco
        titulo="Dinheiro"
        explicacao="Receita conta só quem está ativo. Custo conta todo mundo que ocupa disco, inclusive quem cancelou — o Backblaze cobra por byte guardado, não por situação."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Cartao
            rotulo="Receita/mês"
            valor={formatarReais(r.receitaMensalCentavos)}
            nota={`${r.porStatus.ativo} pagante${r.porStatus.ativo === 1 ? "" : "s"}`}
            tom="ok"
          />
          <Cartao
            rotulo="Por pagante"
            valor={formatarReais(r.receitaPorPaganteCentavos)}
            nota="média do que cada um paga"
          />
          <Cartao
            rotulo="Armazenamento"
            valor={formatarReais(r.custoMensalCentavos)}
            nota={`teto ${formatarReais(r.custoTetoCentavos)} se todos encherem`}
          />
          <Cartao
            rotulo="Custo fixo"
            valor={formatarReais(r.custoFixoCentavos)}
            nota="DAS, VPS, domínio — não muda com cliente"
          />
          <Cartao
            rotulo="Resultado/mês"
            valor={formatarReais(r.resultadoMensalCentavos)}
            nota={
              faltamClientes
                ? `faltam ~${faltamClientes} cliente${faltamClientes === 1 ? "" : "s"} como os de hoje`
                : r.resultadoMensalCentavos >= 0
                  ? "a operação se paga"
                  : "sem pagante para projetar"
            }
            tom={r.resultadoMensalCentavos >= 0 ? "ok" : "erro"}
          />
        </div>
      </Bloco>

      {/* ── 2. CONTAS ─────────────────────────────────────────────────── */}
      <Bloco titulo="Contas" explicacao="Quem existe hoje, e quem chegou agora.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Cartao rotulo="Estúdios" valor={r.estudios} nota={`+${r.novos30} em 30 dias`} />
          <Cartao rotulo="Pagando" valor={r.porStatus.ativo} tom="ok" />
          <Cartao
            rotulo="Em teste"
            valor={r.porStatus.trial}
            nota={vencidos.length > 0 ? `${vencidos.length} já venceu` : undefined}
            tom="acento"
          />
          <Cartao
            rotulo="Inadimplente"
            valor={r.porStatus.inadimplente}
            tom={r.porStatus.inadimplente > 0 ? "alerta" : "neutro"}
          />
          <Cartao
            rotulo="Cancelado"
            valor={r.porStatus.cancelado}
            tom={r.porStatus.cancelado > 0 ? "erro" : "neutro"}
          />
          <Cartao
            rotulo="Conversão"
            valor={porcento(r.conversao)}
            nota="pagantes sobre o total"
          />
        </div>
      </Bloco>

      {/* ── 3. ESPAÇO ─────────────────────────────────────────────────── */}
      <Bloco
        titulo="Espaço"
        explicacao="O que está guardado agora, contra o que foi vendido. A quota de quem está em teste é o teto do período gratuito, não a do plano escolhido."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Cartao
            rotulo="No ar"
            valor={formatarBytes(r.bytesNoAr)}
            nota="galerias servidas hoje"
          />
          <Cartao
            rotulo="No cofre"
            valor={formatarBytes(r.bytesNoCofre)}
            nota="arquivadas — custam igual"
          />
          <Cartao rotulo="Guardado" valor={formatarBytes(r.bytesGuardados)} />
          <Cartao
            rotulo="Vendido"
            valor={formatarBytes(r.quotaVendidaBytes)}
            nota={`${porcento(r.ocupacao)} ocupado`}
          />
        </div>
        <div className="mt-3">
          <Barra fracao={r.ocupacao} tom={r.ocupacao > 0.85 ? "alerta" : "acento"} />
        </div>
      </Bloco>

      {/* ── 4. USO E ENTREGA ──────────────────────────────────────────── */}
      <Bloco
        titulo="Uso e entrega"
        explicacao="Acessos dos últimos 30 dias. É a prova de que a entrega chegou ao cliente final — e de que o produto está sendo usado, não só contratado."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Cartao rotulo="Galerias" valor={totalGalerias} nota={`${totalPublicadas} no ar`} />
          <Cartao rotulo="Fotos" valor={totalFotos.toLocaleString("pt-BR")} />
          <Cartao rotulo="Vídeos" valor={totalVideos.toLocaleString("pt-BR")} />
          <Cartao rotulo="Aberturas" valor={entrega.abriu.toLocaleString("pt-BR")} />
          <Cartao rotulo="Downloads" valor={entrega.baixou.toLocaleString("pt-BR")} />
          <Cartao rotulo="Baixou tudo" valor={entrega.baixou_tudo.toLocaleString("pt-BR")} />
          <Cartao rotulo="Favoritadas" valor={totalFavoritas.toLocaleString("pt-BR")} />
        </div>
      </Bloco>

      {/* ── 5. CRESCIMENTO ────────────────────────────────────────────── */}
      <Bloco
        titulo="Doze meses"
        explicacao="Cadastros e envio, mês a mês. A escala de cada série é o maior mês dela — as duas não se comparam entre si."
      >
        <div className="overflow-x-auto rounded-xl border border-linha bg-carbon p-4">
          <div className="flex min-w-[560px] items-end gap-2">
            {meses.map((m) => {
              const gb = Number(m.bytes_enviados) / GB;
              return (
                <div key={m.mes} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] tabular-nums text-texto-faint">
                    {m.cadastros > 0 ? m.cadastros : ""}
                  </span>
                  <div className="flex h-24 w-full items-end gap-0.5">
                    <div
                      className="flex-1 rounded-t bg-acento/70"
                      style={{ height: `${(m.cadastros / tetoCadastros) * 100}%` }}
                      title={`${m.cadastros} cadastro(s)`}
                    />
                    <div
                      className="flex-1 rounded-t bg-ok/60"
                      style={{ height: `${(Number(m.bytes_enviados) / tetoBytes) * 100}%` }}
                      title={`${gb.toFixed(1)} GB enviados`}
                    />
                  </div>
                  <span className="font-mono text-[9px] text-texto-faint">
                    {m.mes.slice(5)}/{m.mes.slice(2, 4)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex gap-4 text-[11px] text-texto-faint">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-acento/70" /> cadastros
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-ok/60" /> envio
            </span>
          </div>
        </div>
      </Bloco>

      {/* ── 6. QUEM PRECISA DE ATENÇÃO ────────────────────────────────── */}
      <Bloco
        titulo="Precisa de atenção"
        explicacao="Cada linha é uma conversa que vale a pena ter esta semana."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Fila
            titulo={`Teste vencendo em 7 dias (${vencendo.length})`}
            vazio="Ninguém vence esta semana."
            itens={vencendo.map((e) => ({
              id: e.id,
              nome: e.nome_estudio,
              detalhe: `vence ${data(e.trial_ate)} · ${formatarBytes(BigInt(e.bytes_no_ar) + BigInt(e.bytes_no_cofre))} enviados`,
            }))}
          />
          <Fila
            titulo={`Teste já vencido (${vencidos.length})`}
            vazio="Nenhum teste vencido."
            itens={vencidos.map((e) => ({
              id: e.id,
              nome: e.nome_estudio,
              detalhe: `venceu ${data(e.trial_ate)} · galerias saem do ar 15 dias depois`,
            }))}
          />
          <Fila
            titulo={`Sem CPF/CNPJ (${semDocumento.length})`}
            vazio="Todo mundo com documento."
            itens={semDocumento.map((e) => ({
              id: e.id,
              nome: e.nome_estudio,
              detalhe: "não consegue assinar até preencher",
            }))}
          />
          <Fila
            titulo={`Espaço apertando (${apertados.length})`}
            vazio="Ninguém acima de 85% da quota."
            itens={apertados.map((e) => ({
              id: e.id,
              nome: e.nome_estudio,
              detalhe: `${formatarBytes(BigInt(e.bytes_no_ar) + BigInt(e.bytes_no_cofre))} de ${formatarBytes(quotaEfetivaBytes(e))}`,
            }))}
          />
          <Fila
            titulo={`Enviou e ninguém abriu (${enviaramSemAbrir.length})`}
            vazio="Toda entrega com arquivo já foi aberta."
            itens={enviaramSemAbrir.map((e) => ({
              id: e.id,
              nome: e.nome_estudio,
              detalhe: `${e.medias} arquivos, nenhum acesso — quase sempre é link que não foi mandado`,
            }))}
          />
        </div>
      </Bloco>

      {/* ── 7. TODOS OS ESTÚDIOS ──────────────────────────────────────── */}
      <Bloco
        titulo={`Estúdios (${estudios.length})`}
        explicacao="Clique num nome para a ficha completa."
      >
        {estudios.length === 0 ? (
          <p className="text-sm text-texto-faint">Nenhum estúdio cadastrado ainda.</p>
        ) : (
          /* A tabela rola sozinha em vez de empurrar a página: num celular,
             tabela larga sem isto arrasta o layout inteiro para o lado. */
          <div className="overflow-x-auto rounded-xl border border-linha">
            <table className="w-full min-w-[1000px] text-sm">
              <thead>
                <tr className="border-b border-linha bg-carbon text-left">
                  {[
                    "Estúdio",
                    "Situação",
                    "Plano",
                    "Paga",
                    "Espaço",
                    "Conteúdo",
                    "Entrega",
                    "Entrou",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-texto-faint"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {estudios.map((e) => {
                  const plano = planoPorId(e.plano_id);
                  const ciclo = cicloDe(e.ciclo_cobranca);
                  const noAr = BigInt(e.bytes_no_ar);
                  const guardado = BigInt(e.bytes_no_cofre);
                  const usado = noAr + guardado;
                  const quota = quotaEfetivaBytes(e);
                  const fracao = quota === BigInt(0) ? 0 : Number(usado) / Number(quota);
                  const paga =
                    e.status === "ativo"
                      ? mensalEquivalenteCentavos(precoMensalDoEstudio(e), e.ciclo_cobranca)
                      : 0;

                  return (
                    <tr key={e.id} className="border-b border-linha align-top last:border-0">
                      <td className="px-4 py-3">
                        <Link
                          href={`/painel/admin/estudios/${e.id}`}
                          className="block font-medium hover:text-acento"
                        >
                          {e.nome_estudio}
                        </Link>
                        <span className="block text-xs text-texto-faint">{e.email}</span>
                        <span className="block font-mono text-[11px] text-texto-faint">
                          /{e.slug}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Situacao status={e.status} />
                        {e.status === "trial" && (
                          <span className="mt-1 block text-[11px] text-texto-faint">
                            até {data(e.trial_ate)}
                          </span>
                        )}
                        {!e.cpf_cnpj && !e.tem_assinatura && (
                          <span className="mt-1 block text-[11px] text-alerta">sem CPF/CNPJ</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {plano?.nome ?? e.plano_id}
                        <span className="mt-0.5 block text-[11px] text-texto-faint">{ciclo}</span>
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums">
                        {paga > 0 ? (
                          <span className="text-ok">{formatarReais(paga)}</span>
                        ) : (
                          <span className="text-texto-faint">—</span>
                        )}
                        {plano && e.status !== "ativo" && (
                          <span className="mt-0.5 block text-[11px] text-texto-faint">
                            plano vale {formatarReais(plano.precoCentavos)}
                          </span>
                        )}
                      </td>
                      <td className="w-40 px-4 py-3 font-mono text-xs tabular-nums">
                        <span className={fracao > 0.85 ? "text-alerta" : ""}>
                          {formatarBytes(usado)}
                        </span>
                        <span className="text-texto-faint"> / {formatarBytes(quota)}</span>
                        <span className="mt-1 block">
                          <Barra fracao={fracao} tom={fracao > 0.85 ? "alerta" : "acento"} />
                        </span>
                        <span className="mt-1 block text-[11px] text-texto-faint">
                          {formatarBytes(guardado)} no cofre
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums">
                        {e.galerias} galeria{e.galerias === 1 ? "" : "s"}
                        <span className="block text-[11px] text-texto-faint">
                          {e.publicadas} no ar · {e.fotos} fotos · {e.videos} vídeos
                        </span>
                        {e.na_lixeira > 0 && (
                          <span className="block text-[11px] text-texto-faint">
                            {e.na_lixeira} na lixeira
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums">
                        {e.ultimo_acesso ? (
                          data(e.ultimo_acesso)
                        ) : e.medias > 0 ? (
                          <span className="text-alerta">nunca abriram</span>
                        ) : (
                          <span className="text-texto-faint">sem envio</span>
                        )}
                        <span className="block text-[11px] text-texto-faint">
                          {e.acessos_30d} acesso{e.acessos_30d === 1 ? "" : "s"} em 30d
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {data(e.criado_em)}
                        <span className="block text-[11px] text-texto-faint">
                          {e.ultimo_envio ? `enviou ${data(e.ultimo_envio)}` : "nunca enviou"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      {/* ── 8. AUDITORIA ──────────────────────────────────────────────── */}
      <Bloco
        titulo="Últimos eventos"
        explicacao="Os oito mais recentes. O log inteiro, com filtro por ação, estúdio e período, fica no histórico."
      >
        {eventos.length === 0 ? (
          <p className="text-sm text-texto-faint">Nada registrado ainda.</p>
        ) : (
          <ul className="divide-y divide-linha rounded-xl border border-linha bg-carbon">
            {eventos.map((ev) => (
              <li key={String(ev.id)} className="flex flex-wrap gap-x-3 px-4 py-1.5 text-xs">
                <span className="font-mono tabular-nums text-texto-faint">
                  {dataHora(ev.criado_em)}
                </span>
                <span className="font-medium">{ev.acao}</span>
                <span className="text-texto-soft">{ev.estudio ?? "—"}</span>
                <span className="text-texto-faint">por {ev.ator}</span>
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/painel/admin/eventos"
          className="mt-3 inline-block text-xs text-acento underline underline-offset-4"
        >
          pesquisar o histórico →
        </Link>
      </Bloco>
    </main>
  );
}

/**
 * Uma fila de atenção.
 *
 * O caso vazio tem texto próprio em vez de sumir: uma seção que desaparece
 * quando está tudo bem ensina a não olhar aquele canto da tela — e é justamente
 * onde se precisa olhar no dia em que algo aparecer.
 */
function Fila({
  titulo,
  vazio,
  itens,
}: {
  titulo: string;
  vazio: string;
  itens: { id: string; nome: string; detalhe: string }[];
}) {
  return (
    <div className="rounded-xl border border-linha bg-carbon p-4">
      <h3 className="text-xs font-semibold">{titulo}</h3>
      {itens.length === 0 ? (
        <p className="mt-2 text-xs text-texto-faint">{vazio}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {itens.slice(0, 8).map((i) => (
            <li key={i.id} className="text-xs">
              <Link
                href={`/painel/admin/estudios/${i.id}`}
                className="font-medium hover:text-acento"
              >
                {i.nome}
              </Link>
              <span className="block text-[11px] text-texto-faint">{i.detalhe}</span>
            </li>
          ))}
          {/* Corte anunciado: fila longa cortada em silêncio se lê como fila
              curta, e o que ficou de fora é exatamente o que precisa de ação. */}
          {itens.length > 8 && (
            <li className="text-[11px] text-texto-faint">
              e mais {itens.length - 8} — a lista completa está na tabela abaixo.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
