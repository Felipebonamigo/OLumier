import type { Metadata } from "next";
import { FUSO } from "@/config/fuso";
import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { espacoSemLimite, quotaEfetivaBytes } from "@/config/trial";
import { buscarTenantPorId, formatarBytes } from "@/lib/tenants";
import { usoPorEstado } from "@/lib/cofre";
import { planoPorId, formatarReais, cicloDe, precoDoCicloCentavos } from "@/config/planos";
import { NOME_DA_FAIXA, descontoDaGaleriaCentavos, ehFaixaAtomatiza } from "@/config/combo";
import {
  asaasConfigurado,
  asaasEmProducao,
  proximaCobranca,
  buscarAssinatura,
  diferencaEmAberto,
} from "@/lib/asaas";
import { rotuloDoCartao } from "@/lib/cartao-salvo";
import { conferirConfiguracao } from "@/config/socios";
import { AssinaturaBotao } from "@/components/assinatura-botao";
import { situacaoDoTenant } from "@/lib/assinatura";
import { PlanoConta } from "@/components/plano-conta";
import { EditorMarca } from "@/components/editor-marca";
import { TrocarSenha } from "@/components/trocar-senha";
import { ChavesApi } from "@/components/chaves-api";
import { CanalDeAvisos } from "@/components/canal-de-avisos";
import { EditorEndereco } from "@/components/editor-endereco";
import { GaleriasDaConta } from "@/components/galerias-da-conta";
import { enderecosAntigos, LIMITE_TROCAS } from "@/lib/endereco";
import { marca } from "@/config/marca";
import { consultar } from "@/lib/db";
import { listarChaves } from "@/lib/chaves-api";
import { estadoDoCanal } from "@/lib/avisos";
import { MINIMO_SENHA } from "@/lib/recuperacao";
import { urlDeLeitura } from "@/lib/r2";
import { dataPrometidaParaApagar } from "@/lib/contas-encerradas";

export const metadata: Metadata = { title: "Conta" };
export const dynamic = "force-dynamic";

const SITUACOES: Record<string, { texto: string; cor: string }> = {
  trial: { texto: "Teste grátis", cor: "text-acento" },
  ativo: { texto: "Assinatura ativa", cor: "text-ok" },
  inadimplente: { texto: "Pagamento em atraso", cor: "text-alerta" },
  cancelado: { texto: "Assinatura cancelada", cor: "text-erro" },
};

export default async function ContaPage() {
  const tenantId = await sessaoAtual();
  if (!tenantId) redirect("/entrar");

  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) redirect("/entrar");

  const plano = planoPorId(tenant.plano_id);
  const uso = await usoPorEstado(tenantId);
  const chavesApi = await listarChaves(tenantId);
  const canal = await estadoDoCanal(tenantId);
  const antigos = await enderecosAntigos(tenantId);

  /* Galerias da conta, com o peso de cada uma. O tamanho vem aqui porque é a
   * informação que responde "qual apago?" — a pergunta que traz alguém a esta
   * lista. Sem ela, apagar vira chute. */
  const galerias = await consultar<{
    id: string;
    titulo: string;
    slug: string;
    estado: string;
    arquivos: string;
    bytes: string;
  }>(
    `select g.id, g.titulo, g.slug, g.estado,
            count(m.id) as arquivos,
            coalesce(sum(m.bytes), 0) as bytes
       from galerias g
       left join medias m on m.galeria_id = g.id and m.pronto
      where g.tenant_id = $1
      group by g.id
      order by g.criado_em desc`,
    [tenantId],
  );

  // O bucket não tem endereço público: a logo é guardada como chave e ganha um
  // link assinado a cada render.
  const urlLogo = tenant.logo_chave ? await urlDeLeitura(tenant.logo_chave, 3600) : null;

  const diasTrial =
    tenant.status === "trial" && tenant.trial_ate
      ? Math.max(
          0,
  /* Componente de SERVIDOR: renderiza uma vez por requisição, e "quantos dias
   * faltam" só existe em relação ao instante do pedido. A regra de pureza mira
   * o cliente, onde uma segunda renderização daria outro número — aqui não há
   * segunda. Guardar a data em estado seria inventar estado para calar o lint. */
  // eslint-disable-next-line react-hooks/purity
          Math.ceil((new Date(tenant.trial_ate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
        )
      : null;

  const apagarEm = dataPrometidaParaApagar(tenant);

  // Só consulta o Asaas se houver assinatura — evita chamada externa à toa.
  const cobranca =
    asaasConfigurado() && tenant.asaas_assinatura_id
      ? await proximaCobranca(tenant.asaas_assinatura_id).catch(() => null)
      : null;

  /* A fatura da DIFERENÇA de uma troca de plano, enquanto não for paga. Ela é
   * avulsa, fora da assinatura — sem isto, quem paga por Pix só a veria no
   * e-mail do Asaas. Ver `lib/troca-de-plano.ts`. */
  const diferencaAberta =
    asaasConfigurado() && tenant.asaas_cliente_id
      ? await diferencaEmAberto(tenant.asaas_cliente_id).catch(() => null)
      : null;

  /*
   * O cartão que o Asaas guardou, se guardou.
   *
   * `.catch(() => null)` e não `throw`: a tela de Conta mostra espaço usado,
   * marca, senha, endereço e chaves de API — derrubar tudo isso porque o Asaas
   * demorou a responder seria trocar um aviso por uma página de erro. Sem
   * resposta, a tela simplesmente não promete cobrança automática, que é o
   * comportamento certo. Ver a regra de silêncio em `lib/cartao-salvo.ts`.
   */
  const cartaoSalvo =
    asaasConfigurado() && tenant.asaas_assinatura_id
      ? rotuloDoCartao(await buscarAssinatura(tenant.asaas_assinatura_id).catch(() => null))
      : null;

  // Estado da divisão entre sócios — carteira faltando não quebra a cobrança,
  // mas precisa ficar visível para não passar despercebido.
  const { ok: splitOk, avisos: avisosSplit } = conferirConfiguracao();

  const situacao = SITUACOES[tenant.status] ?? { texto: tenant.status, cor: "text-texto-soft" };

  /* O combo que a última conferência encontrou. É o que a assinatura cobra —
   * a coluna só é gravada junto com o valor no Asaas (ver `lib/combo.ts`). */
  const faixaDoCombo = ehFaixaAtomatiza(tenant.combo_atomatiza) ? tenant.combo_atomatiza : null;
  const descontoDoCombo = plano ? descontoDaGaleriaCentavos(plano, faixaDoCombo) : 0;
  /* A próxima fatura já sai com o desconto? Compara com o preço cheio do
   * ciclo: a fatura emitida antes do combo entrar pode ainda estar no cheio
   * (subir não mexe na fatura emitida; baixar mexe — ver `recalcularCombo`). */
  const faturaComCombo =
    descontoDoCombo > 0 && plano && cobranca
      ? Math.round(cobranca.value * 100) < precoDoCicloCentavos(plano.precoCentavos, cicloDe(tenant.ciclo_cobranca))
      : false;
  const situacaoEnvio = situacaoDoTenant(tenant, asaasConfigurado());

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Conta</h1>

      {/* Assinatura */}
      <section className="mt-8 rounded-xl border border-linha bg-carbon p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Assinatura</h2>
          <span className={`text-xs font-medium ${situacao.cor}`}>
            {situacao.texto}
            {diasTrial !== null && ` · ${diasTrial} ${diasTrial === 1 ? "dia" : "dias"}`}
          </span>
        </div>

        <p className="mt-2 text-sm text-texto-soft">
          {plano ? (
            <>
              {plano.nome} —{" "}
              {descontoDoCombo > 0 && (
                <>
                  <s className="text-texto-faint">{formatarReais(plano.precoCentavos)}</s>{" "}
                </>
              )}
              <strong className="text-texto">{formatarReais(plano.precoCentavos - descontoDoCombo)}</strong>
              /mês
            </>
          ) : (
            tenant.plano_id
          )}
        </p>

        {/* O DESCONTO DO COMBO, explicado (30/09/2026 — Felipe: "mostre em tela
            também, explicando que tem o desconto por ter assinatura do
            Atomatiza"). Uma linha verde miúda passava despercebida, e quem
            paga precisa saber por que o valor é outro — e o que o mantém. */}
        {plano && descontoDoCombo > 0 && faixaDoCombo && (
          <div className="mt-3 rounded-lg border border-ok/40 bg-ok/10 px-4 py-3">
            <p className="text-sm font-medium text-ok">Desconto do combo com o Atomatiza</p>
            <p className="mt-1 text-xs text-texto-soft">
              Você também assina o Atomatiza {NOME_DA_FAIXA[faixaDoCombo]} com o mesmo CPF/CNPJ, então a Galeria sai
              por {formatarReais(plano.precoCentavos - descontoDoCombo)} em vez de {formatarReais(plano.precoCentavos)}:{" "}
              {formatarReais(descontoDoCombo)} a menos por mês. O Atomatiza aplica a parte dele do desconto na
              assinatura de lá. Vale enquanto as duas assinaturas estiverem em dia.
            </p>
          </div>
        )}

        <PlanoConta
          planoAtual={tenant.plano_id}
          temAssinatura={Boolean(tenant.asaas_assinatura_id)}
        />

        {diferencaAberta && (
          <div className="mt-4 rounded-lg border border-alerta/40 bg-alerta/10 px-4 py-3">
            <p className="text-xs text-texto-soft">
              Diferença da troca de plano · {formatarReais(Math.round(diferencaAberta.value * 100))} · vence em{" "}
              {new Date(`${diferencaAberta.dueDate}T12:00:00`).toLocaleDateString("pt-BR", { timeZone: FUSO })}
            </p>
            {diferencaAberta.invoiceUrl && (
              <a
                href={diferencaAberta.invoiceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-sm text-acento underline underline-offset-4"
              >
                Pagar a diferença ↗
              </a>
            )}
          </div>
        )}

        {cobranca ? (
          <div className="mt-4 rounded-lg border border-linha bg-void px-4 py-3">
            <p className="text-xs text-texto-soft">
              Próxima cobrança em{" "}
              {new Date(cobranca.dueDate).toLocaleDateString("pt-BR", { timeZone: FUSO })} ·{" "}
              {formatarReais(Math.round(cobranca.value * 100))}
              {faturaComCombo && <span className="text-ok"> · já com o desconto do combo</span>}
            </p>
            {/* A promessa só aparece quando dá para mostrar EM QUAL cartão —
                prometer "automático" sem provar faria quem paga por Pix parar
                de pagar. Ver `lib/cartao-salvo.ts`. */}
            {cartaoSalvo ? (
              <p className="mt-1 text-xs text-ok">
                Cobrança automática no {cartaoSalvo} — você não precisa fazer nada.
              </p>
            ) : null}
            <a
              href={cobranca.invoiceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm text-acento underline underline-offset-4"
            >
              {cartaoSalvo ? "Ver a fatura ↗" : "Ver e pagar ↗"}
            </a>
          </div>
        ) : (
          <AssinaturaBotao
            temAssinatura={Boolean(tenant.asaas_assinatura_id)}
            cobrancaLigada={asaasConfigurado()}
            documentoSalvo={tenant.cpf_cnpj}
            /* Só o MENSAL da faixa. O anual é derivado na tela a partir de
               `MESES_PAGOS_NO_ANO`, para não existir um segundo lugar guardando
               preço — e para o desconto na tela nunca discordar do cobrado. */
            precoMensalCentavos={plano?.precoCentavos ?? 0}
          />
        )}

        {/* Aviso só quando a cobrança está ligada mas o split não foi configurado:
            enquanto tudo fica na conta principal, é fácil esquecer que os sócios
            não estão recebendo. */}
        {asaasConfigurado() && !splitOk && (
          <div className="mt-3 rounded-lg border border-linha bg-void px-3 py-2 text-xs text-texto-faint">
            <p className="font-medium text-texto-soft">Divisão entre sócios ainda não configurada</p>
            <ul className="mt-1 list-disc pl-4">
              {avisosSplit.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <p className="mt-1">Por enquanto, o valor inteiro fica na conta principal.</p>
          </div>
        )}

        {/* Quando o envio está travado, dizer aqui — senão a pessoa só descobre
            no meio de um upload que falha, sem entender por quê. */}
        {!situacaoEnvio.podeEnviar && (
          <p
            role="status"
            className="mt-3 rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-xs text-alerta"
          >
            {situacaoEnvio.recado}
          </p>
        )}

        {/* Pode enviar, mas tem prazo — o caso de quem cancelou no meio de um
            período já pago. Precisa de linha própria: o bloco acima só desenha
            dentro de `!podeEnviar`, e um aviso enfiado lá nunca apareceria.
            Cor de aviso, não de erro: nada está errado, só tem data para
            acabar. */}
        {/* A data que o último aviso prometeu, quando a conta encerrada já
            entrou no calendário de exclusão. Está nos e-mails; aqui é para
            quem abre o painel antes de abrir o e-mail. */}
        {apagarEm && (
          <p
            role="status"
            className="mt-3 rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-xs text-alerta"
          >
            Os arquivos desta conta serão apagados em{" "}
            {apagarEm.toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "long",
              year: "numeric",
              timeZone: "America/Sao_Paulo",
            })}
            . Reativar a assinatura antes dessa data mantém tudo como está.
          </p>
        )}

        {situacaoEnvio.aviso && (
          <p
            role="status"
            className="mt-3 rounded-lg border border-linha bg-void px-3 py-2 text-xs text-texto-soft"
          >
            {situacaoEnvio.aviso}
          </p>
        )}

        {asaasConfigurado() && !asaasEmProducao() && (
          <p className="mt-3 rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-xs text-alerta">
            Cobrança em modo de teste — nenhum dinheiro é movimentado de verdade.
          </p>
        )}
      </section>

      {/*
       * UM limite só, e a quebra vem embaixo como INFORMAÇÃO.
       *
       * A distinção importa: enquanto foram dois baldes, cada barra era um teto
       * que podia estourar sozinho. Agora existe um teto — a soma —, e saber
       * quanto está no ar contra quanto está guardado é dado útil, não regra.
       * Desenhar as duas barras de novo faria o fotógrafo procurar dois limites
       * que não existem mais.
       */}
      <section className="mt-6 rounded-xl border border-linha bg-carbon p-5">
        <h2 className="text-sm font-semibold">Espaço</h2>
        <div className="mt-4">
          <Balde
            rotulo="Espaço do estúdio"
            usado={uso.noAr + uso.noCofre}
            limite={espacoSemLimite(tenant) ? null : quotaEfetivaBytes(tenant)}
            nota="Galerias no ar e entregas guardadas usam o mesmo espaço."
          />
          <p className="mt-3 font-mono text-[11px] tabular-nums text-texto-faint">
            {formatarBytes(uso.noAr)} no ar · {formatarBytes(uso.noCofre)} guardado
          </p>
        </div>
      </section>

      {/* Marca — logo, nome e cor. O que o cliente final vê. */}
      <EditorMarca
        nomeEstudio={tenant.nome_estudio}
        corDestaque={tenant.cor_destaque}
        urlLogo={urlLogo}
        fonteNome={tenant.fonte_nome}
        slug={tenant.slug}
      />

      <TrocarSenha minimo={MINIMO_SENHA} />

      <ChavesApi
        chaves={chavesApi.map((c) => ({
          id: c.id,
          nome: c.nome,
          prefixo: c.prefixo,
          escopo: c.escopo,
          criada_em: c.criada_em.toISOString(),
          ultimo_uso_em: c.ultimo_uso_em ? c.ultimo_uso_em.toISOString() : null,
        }))}
      />

      {/* Logo abaixo das chaves de API, e é o lugar certo: as duas respondem à
          mesma pergunta — o que, de fora, alcança esta conta. Uma é a porta de
          entrada; esta é a de saída. Só aparece para quem tem canal. */}
      {canal && (
        <CanalDeAvisos
          canal={{
            url: canal.url,
            criadoEm: canal.criadoEm.toISOString(),
            ultimoEnvioEm: canal.ultimoEnvioEm ? canal.ultimoEnvioEm.toISOString() : null,
            ultimoErro: canal.ultimoErro,
          }}
        />
      )}

      {/* O endereço saiu da lista de "dados" logo abaixo: ele deixou de ser um
          fato imutável da conta e virou algo que se troca (migração 025). */}
      <EditorEndereco
        slug={tenant.slug}
        dominio={marca.dominio}
        antigos={antigos.map((a) => a.slug)}
        restam={Math.max(0, LIMITE_TROCAS - antigos.length)}
      />

      <GaleriasDaConta
        galerias={galerias.map((g) => ({
          id: g.id,
          titulo: g.titulo,
          slug: g.slug,
          estado: g.estado,
          arquivos: Number(g.arquivos),
          bytes: Number(g.bytes),
        }))}
      />

      {/* Dados */}
      <section className="mt-6 rounded-xl border border-linha bg-carbon">
        <dl className="divide-y divide-linha">
          {[{ rotulo: "E-mail", valor: tenant.email }].map((l) => (
            <div key={l.rotulo} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4">
              <dt className="min-w-[10rem] text-sm text-texto-soft">{l.rotulo}</dt>
              <dd className="text-sm font-medium">{l.valor}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}

/**
 * Uma barra de uso. Mostra a porcentagem porque "2,1 TB de 5 TB" exige conta de
 * cabeça, e a pessoa só quer saber se está perto do fim.
 *
 * Acima do limite a barra fica cheia e muda de cor em vez de estourar o
 * contêiner — passar do cofre é possível (o arquivamento automático não recusa,
 * ver src/lib/cofre.ts) e a tela precisa mostrar isso com clareza.
 */
function Balde({
  rotulo,
  usado,
  limite,
  nota,
}: {
  rotulo: string;
  usado: bigint;
  /** `null` = sem limite (conta de cortesia). */
  limite: bigint | null;
  nota: string;
}) {
  const pct = limite && limite > BigInt(0) ? Number((usado * BigInt(1000)) / limite) / 10 : 0;
  const estourou = limite !== null && usado > limite;
  const apertado = pct >= 85;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-xs font-medium text-texto-soft">{rotulo}</span>
        <span
          className={`font-mono text-[11px] tabular-nums ${
            estourou ? "text-erro" : apertado ? "text-alerta" : "text-texto-faint"
          }`}
        >
          {limite === null
            ? `${formatarBytes(usado)} · sem limite`
            : `${formatarBytes(usado)} de ${formatarBytes(limite)}`}
          {limite !== null && limite > BigInt(0) && ` · ${pct.toFixed(0)}%`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-void">
        <div
          className={`h-full rounded-full ${
            estourou ? "bg-erro" : apertado ? "bg-alerta" : "bg-acento"
          }`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-texto-faint">
        {estourou ? "Acima do limite do plano — libere espaço ou aumente o plano." : nota}
      </p>
    </div>
  );
}
