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
import { mesAMes } from "@/lib/fechamento-mensal";
import { mesDeBrasilia, numerosDoMes } from "@/lib/fechamento-mensal-regras";
import { TabelaMesAMes } from "@/components/admin-mes-a-mes";
import { TabelaOndeOTempoVai } from "@/components/admin-onde-o-tempo-vai";
import { listarCustos } from "@/lib/custos-da-sociedade";
import { custoFixoDaGaleriaCentavos } from "@/lib/custos-da-sociedade-regras";
import { zipRemotoConfigurado } from "@/lib/zip-remoto";
import { velocidadeReal, ultimasVelocidadesDosEstudios, type VelocidadesDosEstudios } from "@/lib/velocidade";
import { formatarVelocidade } from "@/lib/velocidade-regras";
import { CelulasDoEstudio, MediaDaPlataforma } from "@/components/admin-celulas-do-estudio";
import {
  resumoDaPlataforma,
  trialsVencendo,
  trialsVencidos,
  custoDasCortesiasCentavos,
  totaisDosEstudios,
  SITUACOES,
} from "@/lib/metricas-admin";
import { formatarReais, GB } from "@/config/planos";
import { quotaEfetivaBytes } from "@/config/trial";
import {
  COLUNAS_DOS_ESTUDIOS,
  chavesDoEstudio,
  lerOrdem,
  type ExtrasDoEstudio,
} from "@/lib/ordem-dos-estudios";
import { TabelaDeEstudios } from "@/components/admin-tabela-de-estudios";
import { ControleDasSecoes } from "@/components/admin-controle-das-secoes";
import {
  Cartao,
  Bloco,
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
  { id: "velocidade", nome: "Velocidade" },
  { id: "meses", nome: "Doze meses" },
  { id: "mes-a-mes", nome: "Mês a mês" },
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
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ ordem?: string | string[]; sentido?: string | string[] }>;
}) {
  await exigirAdmin();

  const [estudios, meses, entrega, somasDeZip, eventos, custos, velocidade, velocidadesDosEstudios] = await Promise.all([
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
    /* A velocidade real de download e de envio, e as falhas do envio. Ver
       `lib/velocidade.ts`. Sem a tabela nova (migração 053), o bloco se cala
       em vez de derrubar a página. */
    velocidadeReal().catch(() => null),
    /* A última velocidade de envio e de download de cada estúdio, lida do que
       já está gravado. Sem as tabelas, as duas colunas ficam "sem medida". */
    ultimasVelocidadesDosEstudios().catch(
      (): VelocidadesDosEstudios => ({ porEstudio: new Map(), geral: { envioMedio: null, downloadMedio: null } }),
    ),
  ]);

  /* Só a TABELA muda de ordem; os totais e as listas de cima leem `estudios`.
     A ordem do endereço sai pronta no HTML; os cliques seguintes são do
     navegador. Ver `lib/ordem-dos-estudios.ts`. */
  const ordem = lerOrdem(await searchParams);
  const extrasDe = (id: string): ExtrasDoEstudio => {
    const v = velocidadesDosEstudios.porEstudio.get(id);
    return { envioBps: v?.envio?.bytesPorSegundo ?? null, downloadBps: v?.download?.bytesPorSegundo ?? null };
  };

  const agora = new Date();
  const r = resumoDaPlataforma(
    estudios,
    agora,
    custos && custos.length > 0 ? custoFixoDaGaleriaCentavos(custos) : undefined,
  );
  /* "Mês a mês": os números DE AGORA entram no mês corrente, calculados da mesma
     lista e do mesmo resumo do bloco Dinheiro — são o mesmo número. Sem a tabela
     de fechamento (migração 068) ainda, a tabela mostra só o que é exato. */
  const vivo = numerosDoMes(estudios, r, mesDeBrasilia(agora), custoDasCortesiasCentavos(estudios));
  const linhasMesAMes = await mesAMes(vivo, 12, agora).catch(() => null);
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
        <Link href="/painel/admin/bio" className="text-acento underline underline-offset-4">
          Link da bio →
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
        {/* Recolher e expandir as seções, e lembrar o que ficou fechado. */}
        <ControleDasSecoes />
      </nav>

      {/* ── 1. DINHEIRO ───────────────────────────────────────────────── */}
      <Bloco
        id={SECOES[0].id}
        recolhivel
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
      <Bloco id={SECOES[1].id} recolhivel titulo="Contas" explicacao="Quem existe hoje, e quem chegou agora.">
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
        recolhivel
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
        recolhivel
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
        recolhivel
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
            nota={`${porcento(trafego.fracaoDoCache)} dos completos saíram do disco · ${somasDeZip.quedasN} caíram · ${somasDeZip.abortadosN - somasDeZip.quedasN} retomados`}
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

      {/* ── 4c. VELOCIDADE REAL (30/09/2026) ──────────────────────────────
          Felipe: "temos que ter velocidade e funcionar". Numa manhã chegaram
          um download a 270–470 KB/s e um envio caindo, e os dois só apareceram
          porque alguém mandou foto. Aqui a velocidade que os clientes de fato
          tiveram, e as desistências do envio antes da reclamação.

          09/10/2026 (migração 069): o envio passou a ser medido pela PASTA
          inteira, que é o que o fotógrafo sente — o número por arquivo, com
          outros cinco subindo junto, não dizia se a internet dele estava
          cheia. E a recusa do servidor (teto do teste, sessão, tipo) saiu das
          desistências: cada foto de um estúdio no teto dos 10 GB virava uma
          "queda" no cartão vermelho. */}
      <Bloco
        id={SECOES[5].id}
        recolhivel
        titulo="Velocidade real"
        explicacao="Medida em cada download de ZIP (30 dias) e em cada envio de fotos (7 dias). A mediana é o caso típico; os 10% mais lentos são quem reclama."
      >
        {!velocidade ? (
          <p className="text-sm text-texto-faint">Sem medidas ainda.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Cartao
                rotulo="Download do ZIP pronto"
                valor={velocidade.downloadDoDisco ? formatarVelocidade(velocidade.downloadDoDisco.mediana) : "—"}
                nota={
                  velocidade.downloadDoDisco
                    ? `10% abaixo de ${formatarVelocidade(velocidade.downloadDoDisco.p10)} · ${velocidade.downloadDoDisco.n} download${velocidade.downloadDoDisco.n === 1 ? "" : "s"}`
                    : "nenhum ZIP saiu do disco no período"
                }
              />
              <Cartao
                rotulo="Download montando"
                valor={velocidade.downloadMontando ? formatarVelocidade(velocidade.downloadMontando.mediana) : "—"}
                nota={
                  velocidade.downloadMontando
                    ? `o primeiro de cada galeria · ${velocidade.downloadMontando.n} download${velocidade.downloadMontando.n === 1 ? "" : "s"}`
                    : "nenhum ZIP montado no período"
                }
              />
              {velocidade.leva ? (
                <Cartao
                  rotulo="Envio de uma pasta"
                  valor={formatarVelocidade(velocidade.leva.mediana)}
                  nota={`do primeiro ao último arquivo · 10% abaixo de ${formatarVelocidade(velocidade.leva.p10)} · ${velocidade.leva.n} envio${velocidade.leva.n === 1 ? "" : "s"}${velocidade.envio ? ` · por arquivo ${formatarVelocidade(velocidade.envio.mediana)}` : ""}`}
                />
              ) : (
                <Cartao
                  rotulo="Envio, por arquivo"
                  valor={velocidade.envio ? formatarVelocidade(velocidade.envio.mediana) : "—"}
                  nota={
                    velocidade.envio
                      ? `com outros subindo junto · 10% abaixo de ${formatarVelocidade(velocidade.envio.p10)} · a pasta inteira, medindo desde 09/10/2026`
                      : "medindo desde 30/09/2026"
                  }
                />
              )}
              <Cartao
                rotulo="Envios que desistiram"
                valor={velocidade.falhas.n}
                nota={
                  velocidade.falhas.n
                    ? `de rede, em ${velocidade.falhas.estudios} estúdio${velocidade.falhas.estudios === 1 ? "" : "s"}, 7 dias`
                    : "nenhum por rede em 7 dias"
                }
                tom={velocidade.falhas.n > 0 ? "erro" : "ok"}
              />
            </div>
            {velocidade.falhas.ultimas.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs">
                {/* Mensagem repetida vira UMA linha com a contagem — "3× a mesma
                    mensagem" (Felipe, 13/10/2026): oito iguais da mesma conta
                    tomavam a tela inteira e escondiam as diferentes. */}
                {velocidade.falhas.ultimas.map((f, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-texto-soft">
                    <span className="font-medium text-texto">{f.estudio}</span>
                    {f.n > 1 && (
                      <span
                        className="rounded border border-linha-forte px-1 font-mono text-[10px] tabular-nums text-texto"
                        title={`${f.n} vezes a mesma mensagem, no mesmo estúdio e navegador`}
                      >
                        {f.n}×
                      </span>
                    )}
                    <span className="text-erro">{f.erro ?? "falhou"}</span>
                    <span className="text-texto-faint">{f.navegador ?? "—"}</span>
                    <span className="text-texto-faint">
                      {f.n > 1 ? "a última em " : ""}
                      {dataHora(f.quando)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {velocidade.recusas.n > 0 && (
              <div className="mt-4 text-xs">
                <p className="text-texto-soft">
                  <span className="font-medium text-texto">
                    {velocidade.recusas.n} recusado{velocidade.recusas.n === 1 ? "" : "s"} pelo servidor
                  </span>{" "}
                  em {velocidade.recusas.estudios} estúdio{velocidade.recusas.estudios === 1 ? "" : "s"}, 7 dias —
                  plano, sessão ou tipo de arquivo, não velocidade.
                </p>
                <ul className="mt-1 space-y-1">
                  {velocidade.recusas.grupos.map((g, i) => (
                    <li key={i} className="flex flex-wrap gap-x-2 text-texto-soft">
                      <span className="font-medium text-texto">{g.estudio}</span>
                      <span>{g.erro ?? "recusado"}</span>
                      <span className="tabular-nums text-texto-faint">
                        {g.n} arquivo{g.n === 1 ? "" : "s"}
                      </span>
                      <span className="text-texto-faint">a última em {dataHora(g.ultima)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* 13/10/2026 (migração 075): a Melannie subiu 8,8 GB, levou 30
                minutos a mais que no Pixieset, e o envio do original ocupou só
                43% do tempo das vagas. Aqui está o resto. */}
            <div className="mt-6">
              <h3 className="text-sm font-medium">Onde o tempo de cada foto vai</h3>
              <p className="mt-1 mb-3 max-w-2xl text-xs text-texto-faint">
                O envio do original é só uma das etapas de cada foto. Aqui as outras: gerar a miniatura, o preparo, a
                confirmação e as tentativas que caíram e foram refeitas.
              </p>
              <TabelaOndeOTempoVai geral={velocidade.etapas.geral} porEstudio={velocidade.etapas.porEstudio} />
            </div>
          </>
        )}
      </Bloco>

      {/* ── 5. CRESCIMENTO ────────────────────────────────────────────── */}
      <Bloco
        id={SECOES[6].id}
        recolhivel
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

      {/* ── 5b. MÊS A MÊS ─────────────────────────────────────────────── */}
      <Bloco
        id={SECOES[7].id}
        recolhivel
        titulo="Mês a mês"
        explicacao="As contas e o dinheiro de cada mês, lado a lado — para acompanhar o custo e o resultado sem depender do retrato de hoje."
      >
        {linhasMesAMes ? (
          <TabelaMesAMes linhas={linhasMesAMes} />
        ) : (
          <p className="rounded-xl border border-linha bg-carbon px-4 py-3 text-xs text-texto-faint">
            Não consegui ler o fechamento mensal agora. O resto da página não depende dele.
          </p>
        )}
      </Bloco>

      {/* ── 6. QUEM PRECISA DE ATENÇÃO ────────────────────────────────── */}
      <Bloco
        id={SECOES[8].id}
        recolhivel
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
        id={SECOES[9].id}
        recolhivel
        titulo={`Estúdios (${estudios.length})`}
        explicacao="Clique num nome para a ficha completa."
      >
        {estudios.length === 0 ? (
          <p className="text-sm text-texto-faint">Nenhum estúdio cadastrado ainda.</p>
        ) : (
          /* A tabela rola dentro da própria caixa, com o cabeçalho e o total
             sempre à vista, e ORDENA NO NAVEGADOR: o servidor manda as células
             de cada estúdio e as chaves de cada coluna uma vez só. Ver
             `components/admin-tabela-de-estudios.tsx`. */
          <>
            {/*
              ── OS CABEÇALHOS ORDENAM (30/09/2026) ─────────────────
              Felipe: "permita ordenar essa lista pelas colunas". Cada
              título é um link para a mesma página na ordem dele; clicar
              de novo inverte. As colunas e o que cada uma ordena moram
              em `lib/ordem-dos-estudios.ts`.

              ── NO NAVEGADOR, NÃO NO SERVIDOR (13/10/2026) ─────────
              Felipe, com 44 estúdios: "está bem bugado para mexer aqui e
              reordenar". Cada clique refazia a página inteira e saltava
              para a âncora. O link continua valendo (sem JavaScript, em
              outra aba, no "copiar endereço"), mas o clique simples ordena
              ali mesmo, sem recarregar nem mexer na rolagem.
            */}
            {/*
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
            */}
            <TabelaDeEstudios
              colunas={COLUNAS_DOS_ESTUDIOS.map((c) => ({ id: c.id, titulo: c.titulo, primeiro: c.primeiro, dica: c.dica }))}
              ordemInicial={ordem}
              linhas={estudios.map((e) => ({
                id: e.id,
                chaves: chavesDoEstudio(e, extrasDe(e.id)),
                celulas: <CelulasDoEstudio e={e} agora={agora} velocidades={velocidadesDosEstudios.porEstudio.get(e.id) ?? null} />,
              }))}
              rodape={
                /*
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
                */
                <tr className="text-xs font-medium tabular-nums">
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
                  <td className="whitespace-nowrap px-4 py-3">
                    <MediaDaPlataforma m={velocidadesDosEstudios.geral.envioMedio} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <MediaDaPlataforma m={velocidadesDosEstudios.geral.downloadMedio} />
                  </td>
                  <td className="px-4 py-3 text-texto-faint">—</td>
                </tr>
              }
            />
            <p className="mt-2 max-w-3xl text-[11px] leading-snug text-texto-faint">
              <strong className="font-medium text-texto-soft">Envio</strong> é a última pasta inteira que o estúdio
              subiu (do primeiro ao último arquivo) — a coluna ordena por ela; quando a fila não fechou (foi parada ou
              a aba foi fechada), vale a mediana das últimas fotos, dita “por arquivo”, que sobe seis ao mesmo tempo
              e por isso parece menor. <strong className="font-medium text-texto-soft">Download</strong> é o último
              ZIP que o servidor de ZIP entregou a um cliente do estúdio. Embaixo de cada um, a{" "}
              <strong className="font-medium text-texto-soft">média dos últimos 30 dias</strong>: todos os bytes
              divididos por todo o tempo, e não a média das velocidades — uma pasta pequena e lenta não pesa o mesmo
              que uma de 8 GB. A linha de total traz a média da plataforma. A navegação da galeria (ver as fotos) não é
              medida.
            </p>
          </>
        )}
      </Bloco>

      {/* ── 8. AUDITORIA ──────────────────────────────────────────────── */}
      <Bloco
        id={SECOES[10].id}
        recolhivel
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
