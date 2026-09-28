import type { Metadata } from "next";
import Link from "next/link";
import { exigirAdmin, metadataDeAdmin } from "@/lib/portao-admin";
import { fotosDaHome, trocasDaHome } from "@/lib/fotos-da-home";
import { armazenamentoConfigurado } from "@/lib/r2";
import {
  GALERIAS_DA_HOME,
  identidadePorId,
  lugaresDaGaleria,
  nomeDoLugar,
  ondeAparece,
  type FotosDaHome,
  type LugarDaHome,
} from "@/config/home-demonstracao";
import { FotoDaHomeAdmin } from "@/components/foto-da-home-admin";
import { dataHora } from "@/components/admin-pecas";

export async function generateMetadata(): Promise<Metadata> {
  return metadataDeAdmin("Fotos da página inicial");
}

export const dynamic = "force-dynamic";

/**
 * AS FOTOS DA PÁGINA INICIAL — a única tela do admin que MUDA alguma coisa.
 *
 * O painel de administração é só leitura por decisão (ver o comentário de
 * `painel/admin/page.tsx`): o administrador não tem ninguém acima para
 * desfazer o engano dele. Esta tela é a exceção pedida pelo Felipe em
 * 28/09/2026 — "também crie na tela de admin" —, e ela cabe na regra porque
 * não toca em conta nem em galeria de ninguém: mexe na vitrine da própria
 * plataforma, cada troca fica na auditoria com o nome de quem fez, e toda
 * troca se desfaz em um clique ("Voltar à padrão").
 *
 * Cada foto é um LUGAR, e a frase de onde ele aparece sai das identidades de
 * `config/home-demonstracao.ts` (`ondeAparece`), não de uma lista à parte.
 * Os lugares vêm agrupados por galeria de exemplo: cada galeria é um
 * casamento, e trocar as fotos dela é trocar as de um casamento só.
 */
export default async function FotosDaHomePage() {
  await exigirAdmin();
  const [fotos, trocas] = await Promise.all([
    fotosDaHome(),
    /* Sem a migração 043 a tabela não existe: a tela abre com tudo no padrão
       em vez de cair. */
    trocasDaHome().catch(() => []),
  ]);
  const porLugar = new Map(trocas.map((t) => [t.lugar, t]));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/painel/admin" className="text-sm text-texto-soft hover:text-texto">
        ← Administração
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight">Fotos da página inicial</h1>
      <p className="mt-1 max-w-3xl text-sm text-texto-soft">
        Cada foto tem um lugar na página. A troca vale para quem abrir a página em seguida, e
        &ldquo;Voltar à padrão&rdquo; devolve a foto que vem com o site. Envie a foto em alta — a
        página prepara os tamanhos sozinha. Foto vertical funciona em todos os lugares; na capa larga,
        marque o foco no rosto.
      </p>
      <p className="mt-2 text-sm">
        <Link href="/" target="_blank" className="text-acento underline underline-offset-4">
          Abrir a página inicial ↗
        </Link>
      </p>

      {!armazenamentoConfigurado && (
        <p className="mt-6 rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-sm text-alerta">
          O armazenamento não está configurado neste ambiente: dá para ver as fotos, não para trocar.
        </p>
      )}

      {GALERIAS_DA_HOME.map((g) => {
        const ident = identidadePorId(g);
        return (
          <section key={g} className="mt-10">
            <h2 className="text-lg font-semibold">{ident?.titulo ?? g}</h2>
            <p className="text-sm text-texto-soft">
              {ident?.rotulo}
              {ident?.pretoEBranco ? " · aparece em preto e branco na página" : ""}
            </p>
            <Lugares lugares={lugaresDaGaleria(g)} fotos={fotos} porLugar={porLugar} />
          </section>
        );
      })}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Fora das galerias</h2>
        <Lugares lugares={["respiro"]} fotos={fotos} porLugar={porLugar} />
      </section>
    </main>
  );
}

function Lugares({
  lugares,
  fotos,
  porLugar,
}: {
  lugares: LugarDaHome[];
  fotos: FotosDaHome;
  porLugar: Map<string, { trocada_em: Date; quem: string | null }>;
}) {
  return (
    <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {lugares.map((lugar) => {
        const troca = porLugar.get(lugar);
        return (
          <FotoDaHomeAdmin
            /* A chave muda com a foto: depois de uma troca o cartão nasce
               de novo, com a descrição e o foco da foto nova. */
            key={`${lugar}:${fotos[lugar].src}`}
            lugar={lugar}
            nome={nomeDoLugar(lugar)}
            onde={ondeAparece(lugar)}
            foto={fotos[lugar]}
            trocada={troca ? { quando: dataHora(troca.trocada_em), quem: troca.quem } : null}
          />
        );
      })}
    </ul>
  );
}
