import { marca } from "@/config/marca";
import { planos, formatarReais } from "@/config/planos";
import { testarConexao } from "@/lib/db";
import { armazenamentoConfigurado, BUCKET } from "@/lib/r2";

export const dynamic = "force-dynamic";

function Item({ ok, titulo, detalhe }: { ok: boolean; titulo: string; detalhe: string }) {
  return (
    <li className="flex items-start gap-3 border-b border-linha py-3 last:border-b-0">
      <span
        aria-hidden
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ok ? "bg-ok" : "bg-alerta"}`}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">
          {titulo}{" "}
          <span className={`text-xs font-normal ${ok ? "text-ok" : "text-alerta"}`}>
            {ok ? "pronto" : "pendente"}
          </span>
        </span>
        <span className="mt-0.5 block text-xs text-texto-faint">{detalhe}</span>
      </span>
    </li>
  );
}

export default async function Home() {
  const banco = await testarConexao();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="flex items-center gap-4">
        <div className="grid h-16 w-16 place-items-center rounded-xl border border-linha-forte bg-carbon-2 text-2xl font-bold text-luz-alta">
          {marca.simbolo}
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{marca.nome}</h1>
          <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-texto-soft">
            galerias de entrega
          </p>
        </div>
      </header>

      <p className="mt-8 max-w-[46ch] text-lg text-luz italic">{marca.tagline}</p>

      <section className="mt-12 rounded-xl border border-linha bg-carbon p-6">
        <h2 className="text-sm font-semibold">Estado da instalação</h2>
        <p className="mt-1 text-xs text-texto-faint">
          Esta tela é temporária — sai quando o painel do fotógrafo entrar no lugar.
        </p>
        <ul className="mt-4">
          <Item
            ok={armazenamentoConfigurado}
            titulo="Armazenamento (Cloudflare R2)"
            detalhe={
              armazenamentoConfigurado
                ? `bucket "${BUCKET}" configurado`
                : "faltam R2_ACCESS_KEY_ID e R2_SECRET_ACCESS_KEY no .env.local"
            }
          />
          <Item
            ok={banco.ok}
            titulo="Banco de dados (Postgres)"
            detalhe={banco.ok ? "conectado" : (banco.erro ?? "sem conexão")}
          />
          <Item ok={false} titulo="Login do fotógrafo" detalhe="próximo passo do roadmap" />
          <Item ok={false} titulo="Upload e galeria pública" detalhe="na sequência" />
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Planos carregados</h2>
        <p className="mt-1 text-xs text-texto-faint">
          Vindos da planilha de custos validada — conferência rápida de que os preços estão certos.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-linha text-left font-mono text-[10px] uppercase tracking-widest text-texto-faint">
                <th className="py-2 pr-4 font-normal">Plano</th>
                <th className="py-2 pr-4 text-right font-normal">Galeria</th>
                <th className="py-2 pr-4 text-right font-normal">Cofre</th>
                <th className="py-2 text-right font-normal">Preço</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {planos.map((p) => (
                <tr key={p.id} className="border-b border-linha last:border-b-0">
                  <td className="py-2 pr-4">{p.nome}</td>
                  <td className="py-2 pr-4 text-right text-texto-soft">{p.quotaGb} GB</td>
                  <td className="py-2 pr-4 text-right text-texto-soft">{p.cofreGb} GB</td>
                  <td className="py-2 text-right font-medium text-luz-alta">
                    {formatarReais(p.precoCentavos)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
