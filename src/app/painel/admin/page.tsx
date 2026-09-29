import type { Metadata } from "next";
import Link from "next/link";
import { formatarBytes } from "@/lib/tenants";
import { exigirAdmin, metadataDeAdmin } from "@/lib/portao-admin";
import {
  panoramaDosEstudios,
  crescimentoMensal,
  entregaRecente,
  entregaDeZipDoMes,
  eventosRecentes,
} from "@/lib/admin";
import { resumoDeTrafego } from "@/lib/metricas-entrega";
import { listarCustos } from "@/lib/custos-da-sociedade";
import { custoFixoDaGaleriaCentavos } from "@/lib/custos-da-sociedade-regras";
import { zipRemotoConfigurado } from "@/lib/zip-remoto";
import {
  resumoDaPlataforma,
  trialsVencendo,
  trialsVencidos,
  precoMensalDoEstudio,
  mensalEquivalenteCentavos,
  custoMensalDoEstudioCentavos,
  custoDasCortesiasCentavos,
  totaisDosEstudios,
  SITUACOES,
} from "@/lib/metricas-admin";
import { planoPorId, formatarReais, cicloDe, GB } from "@/config/planos";
import { espacoSemLimite, quotaEfetivaBytes } from "@/config/trial";
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
 * ── O ÍNDICE DO TOPO (29/09/2026) ─────────────────────────────────────────
 *
 * Felipe, com um print da tabela de estúdios: "cadê a página dos sócios, que
 * mostrava tudo?".
 *
 * Nada tinha sumido. A página inteira estava lá — os oito blocos ACIMA da
 * tabela —, e ele estava rolado até o pé. Uma página de nove blocos que só se
 * percorre rolando não mostra o que tem; ela esconde tudo menos onde o dedo
 * parou.
 *
 * A ordem desta lista É a ordem da página, e os dois lados leem daqui: o índice
 * mapeia a lista, e cada `<Bloco>` pega o seu `id` por posição. Um bloco novo
 * sem entrada aqui não compila — e `testar-indice-do-admin.mjs` ainda confere,
 * no HTML servido, que nenhum link cai no vazio e que nenhum bloco ficou de
 * fora. Índice escrito à mão apodrece em silêncio: o link simplesmente não leva
 * a lugar nenhum, e ninguém repara até precisar.
 */
const SECOES = [
  { id: "dinheiro", nome: "Dinheiro" },
  { id: "contas", nome: "Contas" },
  { id: "espaco", nome: "Espaço" },
  { id: "uso", nome: "Uso e entrega" },
  { id: "trafego", nome: "Tráfego" },
  { id: "meses", nome: "Doze meses" },
  { id: "atencao", nome: "Precisa de atenção" },
  { id: "estudios", nome: "Estúdios" },
  { id: "eventos", nome: "Eventos" },
] as const;

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

  const [estudios, meses, entrega, somasDeZip, eventos, custos] = await Promise.all([
    panoramaDosEstudios(),
    crescimentoMensal(12),
    entregaRecente(30),
    entregaDeZipDoMes(),
    /*
     * OITO, e não quarenta. Uma limpeza de galeria despeja trinta
     * `media.apagada` no mesmo minuto: com quarenta linhas, o painel terminava
     * com meia tela da mesma frase repetida, e o evento que importava ficava
     * fora dela. O que sai daqui não some — está em /painel/admin/eventos, com
     * filtro por ação, estúdio e período.
     */
    eventosRecentes(8),
    /* O custo fixo sai da lista do caixa dos sócios (migração 047), a mesma
       que eles editam lá. Sem a tabela, vale o de `config/custos-fixos.ts`. */
    listarCustos().catch(() => null),
  ]);

  const agora = new Date();
  const r = resumoDaPlataforma(
    estudios,
    agora,
    custos && custos.length > 0 ? custoFixoDaGaleriaCentavos(custos) : undefined,
  );
  const trafego = resumoDeTrafego(somasDeZip, {
    bytesGuardados: r.bytesGuardados,
    custoDoGuardadoCentavos: r.custoMensalCentavos,
    servidorConfigurado: zipRemotoConfigurado(),
  });
  const tomDoAviso = { ok: "text-ok", alerta: "text-alerta", erro: "text-erro" } as const;

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
  /* A linha de total da tabela lá embaixo. Calculada aqui, ao lado do resumo
     do topo, porque as duas leem a MESMA lista — é o que garante que o total
     de "Paga" e a "Receita/mês" do primeiro bloco não divirjam. */
  const totais = totaisDosEstudios(estudios);
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
      {/* A vitrine da plataforma muda numa tela à parte, que é a única do
          admin com botão que altera alguma coisa. */}
      <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <Link href="/painel/admin/caixa" className="text-acento underline underline-offset-4">
          Caixa dos sócios →
        </Link>
        <Link href="/painel/admin/home" className="text-acento underline underline-offset-4">
          Fotos da página inicial →
        </Link>
      </p>

      {/* O índice. Âncoras de verdade (`<a href="#id">`), e não `<Link>`: o
          destino é esta mesma página, e o roteador não tem nada a resolver. */}
      <nav
        aria-label="Seções desta página"
        className="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-y border-linha py-3"
      >
        {SECOES.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="font-mono text-[11px] uppercase tracking-widest text-texto-faint transition hover:text-acento"
          >
            {s.nome}
          </a>
        ))}
      </nav>

      {/* ── 1. DINHEIRO ───────────────────────────────────────────────── */}
      <Bloco
        id={SECOES[0].id}
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
          {/* Pedido do Felipe em 16/09/2026: as contas dos sócios (cortesia) não
              pagam pelo sistema e não têm limite de espaço — o custo do que
              elas guardam é acertado por fora. Este é o total a cobrar. */}
          <Cartao
            rotulo="Cortesias"
            valor={formatarReais(custoDasCortesiasCentavos(estudios))}
            nota="a cobrar por fora — armazenamento das contas dos sócios"
          />
          <Cartao
            rotulo="Custo fixo"
            valor={formatarReais(r.custoFixoCentavos)}
            nota="da lista do caixa dos sócios — não muda com cliente"
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
      <Bloco id={SECOES[1].id} titulo="Contas" explicacao="Quem existe hoje, e quem chegou agora.">
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
        id={SECOES[2].id}
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
        id={SECOES[3].id}
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

      {/* ── 4b. TRÁFEGO E CUSTO DA ENTREGA ────────────────────────────── */}
      <Bloco
        id={SECOES[4].id}
        titulo="Tráfego e custo da entrega"
        explicacao="O mês corrente. É a tela que responde se o desenho da entrega está custando o previsto — e o que fazer quando não estiver. Download avulso é estimativa pelo tamanho médio de uma mídia."
      >
        <ul className="mb-3 space-y-1">
          {trafego.avisos.map((a) => (
            <li key={a.texto} className={`text-sm ${tomDoAviso[a.nivel]}`}>
              {a.nivel === "ok" ? "✓" : a.nivel === "erro" ? "✗" : "!"} {a.texto}
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Cartao
            rotulo="ZIPs montados"
            valor={somasDeZip.montadosN}
            nota={`${formatarBytes(BigInt(Math.round(somasDeZip.montadosBytes)))} lidos do armazém`}
          />
          <Cartao
            rotulo="ZIPs entregues"
            valor={somasDeZip.servidosServidorN + somasDeZip.servidosVpsN}
            nota={`${porcento(trafego.fracaoDoCache)} dos completos saíram do disco · ${somasDeZip.abortadosN} caíram no meio`}
            tom="ok"
          />
          <Cartao
            rotulo="Download avulso"
            valor={somasDeZip.avulsosN.toLocaleString("pt-BR")}
            nota={`~${formatarBytes(BigInt(Math.round(somasDeZip.avulsosN * somasDeZip.bytesPorMedia)))} direto do B2 (estimativa)`}
          />
          <Cartao
            rotulo="Custo do tráfego"
            valor={formatarReais(trafego.custoTrafegoCentavos)}
            nota={trafego.custoTrafegoCentavos === 0 ? "tudo dentro das franquias" : "excedente do B2 e do servidor"}
            tom={trafego.custoTrafegoCentavos === 0 ? "ok" : "erro"}
          />
          <Cartao
            rotulo="Disco do ZIP"
            valor={
              somasDeZip.remontagensN > 0
                ? `${somasDeZip.remontagensN} remontado${somasDeZip.remontagensN === 1 ? "" : "s"}`
                : somasDeZip.despejosN > 0
                  ? `${somasDeZip.despejosN} apagado${somasDeZip.despejosN === 1 ? "" : "s"}`
                  : "folgado"
            }
            nota={
              trafego.discoSugeridoGb
                ? `uso de 14 dias pede ~${trafego.discoSugeridoGb.toLocaleString("pt-BR")} GB`
                : "sem montagens para medir"
            }
            tom={somasDeZip.remontagensN >= 3 ? "erro" : somasDeZip.despejosN > 0 ? "alerta" : "ok"}
          />
          <Cartao
            rotulo="Servidor de ZIP"
            valor={formatarReais(trafego.custoServidorZipCentavos)}
            nota="fixo por mês — some quando dilui nos TB"
          />
          <Cartao
            rotulo="Por TB guardado"
            valor={trafego.custoPorTbGuardadoCentavos === null ? "—" : formatarReais(trafego.custoPorTbGuardadoCentavos)}
            nota="armazenamento + servidor + tráfego, por TB"
            tom={
              trafego.custoPorTbGuardadoCentavos !== null && trafego.custoPorTbGuardadoCentavos > 8400
                ? "alerta"
                : "neutro"
            }
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-texto-faint">
              <span>Download do B2 vs franquia (3× o guardado)</span>
              <span className="tabular-nums">
                {formatarBytes(BigInt(Math.round(trafego.egressB2Bytes)))} / {formatarBytes(BigInt(Math.round(trafego.franquiaB2Bytes)))}
              </span>
            </div>
            <Barra fracao={trafego.fracaoB2} tom={trafego.fracaoB2 >= 0.8 ? "alerta" : "ok"} />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-texto-faint">
              <span>Servidor de ZIP vs 20 TB/mês</span>
              <span className="tabular-nums">{formatarBytes(BigInt(Math.round(trafego.trafegoServidorBytes)))}</span>
            </div>
            <Barra fracao={trafego.fracaoServidor} tom={trafego.fracaoServidor >= 0.6 ? "alerta" : "ok"} />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-texto-faint">
              <span>ZIP pelo VPS vs 8 TB/mês (deveria ser zero)</span>
              <span className="tabular-nums">{formatarBytes(BigInt(Math.round(trafego.trafegoVpsBytes)))}</span>
            </div>
            <Barra fracao={trafego.fracaoVps} tom={trafego.trafegoVpsBytes > 0 ? "alerta" : "ok"} />
          </div>
        </div>
      </Bloco>

      {/* ── 5. CRESCIMENTO ────────────────────────────────────────────── */}
      <Bloco
        id={SECOES[5].id}
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
        id={SECOES[6].id}
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
        id={SECOES[7].id}
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
                    "Custa por mês",
                    "Espaço",
                    "Conteúdo",
                    /*
                      ── DOIS NOMES QUE FALTAVAM (29/09/2026) ──────────────

                      Felipe: "último acesso, última alteração também".

                      O último acesso do CLIENTE já estava nesta tabela — mas
                      debaixo de um cabeçalho chamado "Entrega", que não diz que
                      ali mora uma data. Quem procura "quando isto foi aberto
                      pela última vez" não encontra uma coluna que se chama
                      outra coisa. Agora a coluna tem o nome do que ela guarda.

                      A última alteração é nova, e é sobre o ESTÚDIO: o mais
                      recente entre editar galeria, subir foto e mexer na conta
                      (ver `ultima_alteracao` em `lib/admin.ts`). As duas juntas
                      respondem a pergunta que a tabela existe para responder —
                      esta conta está viva dos dois lados?
                    */
                    /*
                      ── AS DATAS AGRUPADAS POR QUEM AGIU (29/09/2026) ──────

                      Eram duas colunas com nome de MOMENTO ("Último acesso",
                      "Última alteração"), e o carimbo do fotógrafo (migração
                      047) pediria uma terceira — três colunas de data seguidas,
                      todas dizendo "29 de set.", sem dizer de quem.

                      Agora o cabeçalho diz QUEM: o cliente de um lado, o
                      estúdio do outro. Cada um leva a sua segunda linha — os
                      acessos de 30 dias com o cliente, a última alteração com o
                      estúdio, que é quem altera. A tabela não cresceu e as três
                      perguntas continuam respondidas.
                    */
                    "Cliente abriu",
                    "Estúdio entrou",
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
                  const semLimite = espacoSemLimite(e);
                  const fracao =
                    semLimite || quota === BigInt(0) ? 0 : Number(usado) / Number(quota);
                  const custa = custoMensalDoEstudioCentavos(e);
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
                      {/* O custo de CADA conta: o que Backblaze e Cloudflare cobram
                          pelo que ela guarda. Nas cortesias é o valor a cobrar. */}
                      <td className="px-4 py-3 text-xs tabular-nums">
                        {formatarReais(custa)}
                        {e.status === "cortesia" && (
                          <span className="mt-0.5 block text-[11px] text-alerta">a cobrar por fora</span>
                        )}
                      </td>
                      <td className="w-40 px-4 py-3 font-mono text-xs tabular-nums">
                        <span className={fracao > 0.85 ? "text-alerta" : ""}>
                          {formatarBytes(usado)}
                        </span>
                        <span className="text-texto-faint">
                          {semLimite ? " · sem limite" : ` / ${formatarBytes(quota)}`}
                        </span>
                        {!semLimite && (
                          <span className="mt-1 block">
                            <Barra fracao={fracao} tom={fracao > 0.85 ? "alerta" : "acento"} />
                          </span>
                        )}
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
                      <td className="px-4 py-3 text-xs tabular-nums">
                        {e.ultimo_acesso_estudio ? (
                          data(e.ultimo_acesso_estudio)
                        ) : (
                          /*
                            Nulo NÃO é conta abandonada: a coluna nasceu em
                            29/09/2026 e toda conta anterior começa sem marca.
                            Um travessão aqui leria como ausência, e a primeira
                            leitura da tabela acusaria a plataforma inteira de
                            estar parada.
                          */
                          <span className="text-texto-faint">sem registro</span>
                        )}
                        <span className="block text-[11px] text-texto-faint">
                          {e.ultima_alteracao
                            ? `alterou ${data(e.ultima_alteracao)}`
                            : "nunca alterou"}
                        </span>
                        <span className="block text-[11px] text-texto-faint">
                          {e.ultimo_envio ? `enviou ${data(e.ultimo_envio)}` : "nunca enviou"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">{data(e.criado_em)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {/*
                ── A LINHA DE TOTAL ────────────────────────────────────────

                Felipe: "tenha uma linha com o 'total' de cada coluna".

                Em `<tfoot>` e não na última linha do `<tbody>`: é o elemento
                que existe para isto, o leitor de tela o anuncia como rodapé da
                tabela, e ele não entra em nenhuma ordenação futura do corpo.

                A aritmética mora em `totaisDosEstudios` (`lib/metricas-admin.ts`),
                e não aqui, porque três colunas não somam do jeito óbvio — Paga
                conta só quem está ativo, Custa conta todo mundo, e a quota de
                quem é sem limite não pode entrar no total. `testar-totais-do-admin.mjs`
                prende as três, com o estúdio sem limite e o cancelado com disco
                cheio na mesma tabela.
              */}
              <tfoot>
                <tr className="border-t-2 border-linha bg-carbon text-xs font-medium tabular-nums">
                  <td className="px-4 py-3">
                    {totais.estudios} estúdio{totais.estudios === 1 ? "" : "s"}
                  </td>
                  <td className="px-4 py-3 text-[11px] font-normal text-texto-faint">
                    {SITUACOES.filter((s) => totais.porStatus[s] > 0)
                      .map((s) => `${totais.porStatus[s]} ${s}`)
                      .join(" · ") || "—"}
                  </td>
                  <td className="px-4 py-3 text-texto-faint">—</td>
                  <td className="px-4 py-3 text-ok">{formatarReais(totais.pagaCentavos)}</td>
                  <td className="px-4 py-3">{formatarReais(totais.custaCentavos)}</td>
                  <td className="px-4 py-3 font-mono">
                    {formatarBytes(totais.usadoBytes)}
                    <span className="font-sans font-normal text-texto-faint">
                      {" / "}
                      {formatarBytes(totais.quotaBytes)}
                    </span>
                    {totais.semLimite > 0 && (
                      <span className="mt-0.5 block font-sans text-[11px] font-normal text-texto-faint">
                        + {totais.semLimite} sem limite
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {totais.galerias} galeria{totais.galerias === 1 ? "" : "s"}
                    <span className="block text-[11px] font-normal text-texto-faint">
                      {totais.publicadas} no ar · {totais.fotos.toLocaleString("pt-BR")} fotos ·{" "}
                      {totais.videos} vídeos
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {totais.ultimoAcesso ? (
                      data(totais.ultimoAcesso)
                    ) : (
                      <span className="font-normal text-texto-faint">nunca</span>
                    )}
                    <span className="block text-[11px] font-normal text-texto-faint">
                      {totais.acessos30d} acesso{totais.acessos30d === 1 ? "" : "s"} em 30d
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {totais.ultimoAcessoEstudio ? (
                      data(totais.ultimoAcessoEstudio)
                    ) : (
                      <span className="font-normal text-texto-faint">sem registro</span>
                    )}
                    <span className="block text-[11px] font-normal text-texto-faint">
                      {totais.ultimaAlteracao
                        ? `alterou ${data(totais.ultimaAlteracao)}`
                        : "nunca alterou"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-texto-faint">—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Bloco>

      {/* ── 8. AUDITORIA ──────────────────────────────────────────────── */}
      <Bloco
        id={SECOES[8].id}
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
