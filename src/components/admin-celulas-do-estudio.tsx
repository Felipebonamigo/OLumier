import Link from "next/link";
import { formatarBytes } from "@/lib/tenants";
import { formatarReais, cicloDe, planoPorId } from "@/config/planos";
import { espacoSemLimite, quotaEfetivaBytes } from "@/config/trial";
import {
  custoMensalDoEstudioCentavos,
  mensalEquivalenteCentavos,
  precoMensalDoEstudio,
} from "@/lib/metricas-admin";
import { formatarVelocidade } from "@/lib/velocidade-regras";
import type { LinhaAdmin } from "@/lib/admin";
import type { MediaDeVelocidade, UltimaVelocidade, VelocidadesDoEstudio } from "@/lib/velocidade";
import { Barra, Situacao, data } from "@/components/admin-pecas";

/**
 * AS CÉLULAS DE UM ESTÚDIO NA TABELA DA ADMINISTRAÇÃO (13/10/2026).
 *
 * Moravam dentro da página. Saíram para cá quando a tabela passou a ordenar no
 * navegador (`admin-tabela-de-estudios.tsx`): o servidor desenha as células de
 * cada estúdio UMA vez, e é o navegador quem decide a ordem das linhas. A ordem
 * das colunas aqui é a de `COLUNAS_DOS_ESTUDIOS` (`lib/ordem-dos-estudios.ts`).
 *
 * Componente de servidor: nada aqui tem estado.
 */

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** O que entrou na média: pastas, fotos ou ZIPs. */
const doQueEAMedia = (m: MediaDeVelocidade) =>
  m.origem === "pasta" ? plural(m.n, "pasta", "pastas") : m.origem === "arquivo" ? plural(m.n, "foto", "fotos") : plural(m.n, "ZIP", "ZIPs");

/**
 * A última velocidade ("9,7 MB/s", e embaixo de onde veio e quando) e, na linha
 * de baixo, a média dos últimos 30 dias — ou "sem medida".
 */
function VelocidadeDoEstudio({
  v,
  media,
  rotulos,
}: {
  v: UltimaVelocidade | null;
  media: MediaDeVelocidade | null;
  rotulos: Partial<Record<UltimaVelocidade["origem"], string>>;
}) {
  if (!v && !media) return <span className="text-texto-faint">sem medida</span>;
  return (
    <>
      {v ? (
        <>
          {formatarVelocidade(v.bytesPorSegundo)}
          <span className="block text-[11px] text-texto-faint">
            {rotulos[v.origem] ?? v.origem} · {data(v.quando)}
          </span>
        </>
      ) : (
        <span className="text-texto-faint">sem medida recente</span>
      )}
      {media && (
        <span
          className="mt-0.5 block text-[11px] text-texto-faint"
          title="todos os bytes dos últimos 30 dias divididos por todo o tempo — a velocidade do conjunto, não a média das velocidades"
        >
          média {formatarVelocidade(media.bytesPorSegundo)} · {doQueEAMedia(media)}
        </span>
      )}
    </>
  );
}

/** A média da plataforma inteira, para a linha de total: "9,7 MB/s" e quantas pastas/fotos/ZIPs. */
export function MediaDaPlataforma({ m }: { m: MediaDeVelocidade | null }) {
  if (!m) return <span className="font-normal text-texto-faint">—</span>;
  return (
    <>
      {formatarVelocidade(m.bytesPorSegundo)}
      <span className="block text-[11px] font-normal text-texto-faint">média · {doQueEAMedia(m)}, 30d</span>
    </>
  );
}

export function CelulasDoEstudio({
  e,
  agora,
  velocidades,
}: {
  e: LinhaAdmin;
  agora: Date;
  velocidades: VelocidadesDoEstudio | null;
}) {
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
    <>
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
        {/* A data do teste não some com o status: conta que
            aparece como inadimplente mas ainda tem teste pela
            frente é a primeira coisa a conferir. */}
        {e.status !== "trial" &&
          e.status !== "ativo" &&
          e.trial_ate &&
          new Date(e.trial_ate).getTime() > agora.getTime() && (
            <span className="mt-1 block text-[11px] text-alerta">
              teste até {data(e.trial_ate)}
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
      <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums">
        <VelocidadeDoEstudio
          v={velocidades?.envio ?? null}
          media={velocidades?.envioMedio ?? null}
          rotulos={{ pasta: "pasta inteira", arquivo: "por arquivo" }}
        />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums">
        <VelocidadeDoEstudio
          v={velocidades?.download ?? null}
          media={velocidades?.downloadMedio ?? null}
          rotulos={{ "zip-pronto": "ZIP pronto", "zip-montando": "ZIP montando" }}
        />
      </td>
      <td className="px-4 py-3 text-xs">{data(e.criado_em)}</td>
    </>
  );
}
