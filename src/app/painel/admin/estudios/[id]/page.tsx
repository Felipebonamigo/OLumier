import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatarBytes } from "@/lib/tenants";
import { exigirAdmin, metadataDeAdmin } from "@/lib/portao-admin";
import { fichaDoEstudio } from "@/lib/admin";
import { mensalEquivalenteCentavos, precoMensalDoEstudio } from "@/lib/metricas-admin";
import { planoPorId, formatarReais, cicloDe, custoArmazenamentoCentavos, GB } from "@/config/planos";
import {
  espacoSemLimite,
  quotaEfetivaBytes,
  TETO_TRIAL_GB,
  CARENCIA_POS_TRIAL_DIAS,
} from "@/config/trial";
import { marca } from "@/config/marca";
import {
  Cartao,
  Bloco,
  Dado,
  Situacao,
  Barra,
  data,
  dataHora,
  porcento,
} from "@/components/admin-pecas";

export async function generateMetadata(): Promise<Metadata> {
  return metadataDeAdmin("Estúdio");
}

export const dynamic = "force-dynamic";

/**
 * A FICHA DE UM ESTÚDIO.
 *
 * O painel responde "como está a plataforma"; esta página responde "o que está
 * acontecendo com o fulano" — que é a pergunta do suporte, feita com o cliente
 * esperando do outro lado.
 *
 * Também só leitura. Nem trocar plano, nem entrar como ele, nem apagar. Ver o
 * comentário em `painel/admin/page.tsx`.
 */
export default async function EstudioPage({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params; // no Next 16 params é Promise

  const ficha = await fichaDoEstudio(id);
  if (!ficha) notFound();

  const { estudio: e, galerias, eventos } = ficha;
  const plano = planoPorId(e.plano_id);
  const ciclo = cicloDe(e.ciclo_cobranca);

  const noAr = BigInt(e.bytes_no_ar);
  const guardado = BigInt(e.bytes_no_cofre);
  const usado = noAr + guardado;
  const quotaPlano = BigInt(e.quota_bytes);
  const quota = quotaEfetivaBytes(e);
  const semLimite = espacoSemLimite(e);
  const fracao = semLimite || quota === BigInt(0) ? 0 : Number(usado) / Number(quota);

  const pagaPorMes =
    e.status === "ativo" ? mensalEquivalenteCentavos(precoMensalDoEstudio(e), e.ciclo_cobranca) : 0;
  const custoDele = Math.round(
    custoArmazenamentoCentavos({ segmento: "foto", espacoGb: Number(usado) / GB }),
  );

  /* O trial rebaixa a quota por REGRA, não por gravação — a coluna continua com
     a do plano. Dizer só "10 GB" faria a ficha parecer contradizer o banco. */
  const quotaRebaixada = e.status === "trial" && quota < quotaPlano;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/painel/admin" className="text-sm text-texto-soft hover:text-texto">
        ← Administração
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{e.nome_estudio}</h1>
        <Situacao status={e.status} />
      </div>
      <p className="mt-1 font-mono text-sm text-texto-faint">
        {e.email} · /{e.slug}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cartao
          rotulo="Paga por mês"
          valor={pagaPorMes > 0 ? formatarReais(pagaPorMes) : "—"}
          nota={plano ? `${plano.nome} · ${ciclo}` : e.plano_id}
          tom={pagaPorMes > 0 ? "ok" : "neutro"}
        />
        <Cartao
          rotulo="Custa por mês"
          valor={formatarReais(custoDele)}
          nota={e.status === "cortesia" ? "a cobrar por fora — B2 + R2 do que guarda" : "B2 + R2 do que ele guarda"}
        />
        <Cartao
          rotulo="Margem"
          valor={formatarReais(pagaPorMes - custoDele)}
          tom={pagaPorMes - custoDele >= 0 ? "ok" : "erro"}
        />
        <Cartao
          rotulo="Espaço"
          valor={formatarBytes(usado)}
          nota={semLimite ? "sem limite (cortesia)" : `${porcento(fracao)} de ${formatarBytes(quota)}`}
          tom={fracao > 0.85 ? "alerta" : "neutro"}
        />
      </div>
      <div className="mt-3">
        <Barra fracao={fracao} tom={fracao > 0.85 ? "alerta" : "acento"} />
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <Bloco titulo="A conta" explicacao="O cadastro, como está no banco agora.">
          <dl className="rounded-xl border border-linha bg-carbon px-4 py-1">
            <Dado nome="Nome do estúdio">{e.nome_estudio}</Dado>
            <Dado nome="E-mail">{e.email}</Dado>
            <Dado nome="Endereço das galerias">
              <span className="font-mono">
                {e.slug}.{marca.dominio}
              </span>
            </Dado>
            <Dado nome="CPF / CNPJ">{e.cpf_cnpj}</Dado>
            <Dado nome="Domínio próprio">
              {e.dominio_proprio ? (
                <>
                  <span className="font-mono">{e.dominio_proprio}</span>
                  <span
                    className={`ml-2 text-[11px] ${e.dominio_verificado_em ? "text-ok" : "text-alerta"}`}
                  >
                    {e.dominio_verificado_em
                      ? `verificado ${data(e.dominio_verificado_em)}`
                      : "não verificado"}
                  </span>
                </>
              ) : null}
            </Dado>
            <Dado nome="Entrou em">{data(e.criado_em)}</Dado>
            <Dado nome="Última troca de senha">{data(e.senha_alterada_em)}</Dado>
          </dl>
        </Bloco>

        <Bloco titulo="A assinatura" explicacao="O Asaas é a fonte de verdade; isto é o espelho.">
          <dl className="rounded-xl border border-linha bg-carbon px-4 py-1">
            <Dado nome="Situação">
              <Situacao status={e.status} />
            </Dado>
            <Dado nome="Plano">
              {plano ? `${plano.nome} — ${formatarReais(plano.precoCentavos)}/mês` : e.plano_id}
            </Dado>
            <Dado nome="Ciclo">
              {ciclo}
              {ciclo === "anual" && (
                <span className="ml-2 text-[11px] text-texto-faint">
                  paga 10 meses, usa 12 — o mês equivalente é {formatarReais(pagaPorMes)}
                </span>
              )}
            </Dado>
            <Dado nome="Fim do teste">
              {e.status === "trial" ? (
                <>
                  {data(e.trial_ate)}
                  <span className="ml-2 text-[11px] text-texto-faint">
                    galerias saem do ar {CARENCIA_POS_TRIAL_DIAS} dias depois
                  </span>
                </>
              ) : null}
            </Dado>
            <Dado nome="Assinatura criada">{data(e.assinatura_criada_em)}</Dado>
            <Dado nome="Último pagamento">{data(e.ultimo_pagamento_em)}</Dado>
            <Dado nome="Pago até">{data(e.pago_ate)}</Dado>
            <Dado nome="Cliente no Asaas">
              {e.asaas_cliente_id ? <span className="font-mono text-xs">{e.asaas_cliente_id}</span> : null}
            </Dado>
            <Dado nome="Assinatura no Asaas">
              {e.asaas_assinatura_id ? (
                <span className="font-mono text-xs">{e.asaas_assinatura_id}</span>
              ) : null}
            </Dado>
          </dl>
        </Bloco>
      </div>

      <Bloco
        titulo="Espaço"
        explicacao="Galeria no ar e arquivo somam na mesma quota desde a unificação do plano."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Cartao rotulo="No ar" valor={formatarBytes(noAr)} />
          <Cartao rotulo="No cofre" valor={formatarBytes(guardado)} nota="arquivadas" />
          <Cartao
            rotulo="Quota efetiva"
            valor={semLimite ? "sem limite" : formatarBytes(quota)}
            nota={
              semLimite
                ? "cortesia — conta de sócio"
                : quotaRebaixada
                ? `plano dá ${formatarBytes(quotaPlano)} — o teste limita a ${TETO_TRIAL_GB} GB`
                : "a do plano"
            }
          />
          <Cartao
            rotulo="Arquivos"
            valor={e.medias.toLocaleString("pt-BR")}
            nota={`${e.fotos} fotos · ${e.videos} vídeos`}
          />
        </div>
      </Bloco>

      <Bloco
        titulo={`Galerias (${galerias.length})`}
        explicacao="Inclui as que estão na lixeira e as arquivadas no cofre."
      >
        {galerias.length === 0 ? (
          <p className="text-sm text-texto-faint">Nenhuma galeria criada.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-linha">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-linha bg-carbon text-left">
                  {["Galeria", "Estado", "Arquivos", "Tamanho", "Acessos", "Criada"].map((h) => (
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
                {galerias.map((g) => (
                  <tr key={g.id} className="border-b border-linha align-top last:border-0">
                    <td className="px-4 py-3">
                      <span className="block font-medium">{g.titulo}</span>
                      <span className="block font-mono text-[11px] text-texto-faint">
                        /{g.slug}
                      </span>
                      {g.subtitulo && (
                        <span className="block text-[11px] text-texto-faint">{g.subtitulo}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {g.apagada_em ? (
                        <span className="text-erro">na lixeira</span>
                      ) : g.estado === "arquivada" ? (
                        <span className="text-texto-soft">no cofre</span>
                      ) : g.publicada ? (
                        <span className="text-ok">no ar</span>
                      ) : (
                        <span className="text-texto-faint">rascunho</span>
                      )}
                      <span className="mt-0.5 block text-[11px] text-texto-faint">
                        {g.tem_senha ? "com senha" : "sem senha"}
                        {g.permite_download ? " · baixa" : " · sem download"}
                      </span>
                      {g.expira_em && (
                        <span className="block text-[11px] text-texto-faint">
                          vence {data(g.expira_em)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums">
                      {g.medias}
                      {g.favoritas > 0 && (
                        <span className="block text-[11px] text-texto-faint">
                          {g.favoritas} favoritada{g.favoritas === 1 ? "" : "s"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">
                      {formatarBytes(g.bytes_total)}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums">
                      {g.acessos}
                      <span className="block text-[11px] text-texto-faint">
                        {g.ultimo_acesso ? data(g.ultimo_acesso) : "nunca abriram"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">{data(g.criado_em)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      <Bloco
        titulo="Histórico"
        explicacao="Os últimos doze eventos desta conta. O resto está no histórico, já filtrado nela."
      >
        {eventos.length === 0 ? (
          <p className="text-sm text-texto-faint">Nada registrado para esta conta.</p>
        ) : (
          <ul className="divide-y divide-linha rounded-xl border border-linha bg-carbon">
            {eventos.map((ev) => (
              <li key={String(ev.id)} className="px-4 py-1.5 text-xs">
                <div className="flex flex-wrap gap-x-3">
                  <span className="font-mono tabular-nums text-texto-faint">
                    {dataHora(ev.criado_em)}
                  </span>
                  <span className="font-medium">{ev.acao}</span>
                  <span className="text-texto-faint">por {ev.ator}</span>
                </div>
                {Object.keys(ev.detalhe ?? {}).length > 0 && (
                  <pre className="mt-0.5 overflow-x-auto font-mono text-[10px] text-texto-faint">
                    {JSON.stringify(ev.detalhe)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
        <Link
          href={`/painel/admin/eventos?estudio=${e.id}`}
          className="mt-3 inline-block text-xs text-acento underline underline-offset-4"
        >
          histórico completo desta conta →
        </Link>
      </Bloco>
    </main>
  );
}
