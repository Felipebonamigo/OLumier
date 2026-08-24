import type { Metadata } from "next";
import Link from "next/link";
import { marca } from "@/config/marca";
import { planos, formatarReais, type Plano } from "@/config/planos";
import { MarcaTile } from "@/components/marca-tile";

export const metadata: Metadata = {
  title: `${marca.nome} — ${marca.tagline}`,
};

const RECURSOS = [
  {
    titulo: "Seu próprio endereço",
    texto: "Cada estúdio ganha um subdomínio — seuestudio.olumier.com.br. Nada de link genérico.",
  },
  {
    titulo: "Vai para a galeria do celular",
    texto: 'Um toque e a foto cai no rolo do iPhone ou Android — não em "Arquivos", onde ninguém acha depois.',
  },
  {
    titulo: "Envio em massa",
    texto: "Suba centenas de fotos de uma vez. Se a conexão cair no meio, o envio retoma sozinho de onde parou.",
  },
  {
    titulo: "Cofre automático",
    texto: "No prazo que você definir, a galeria sai do ar sozinha e vai para o cofre. Nada é apagado — você reativa quando o cliente pedir.",
  },
  {
    titulo: "A aparência que você quiser",
    texto: "Quatro estilos prontos, ou combine capa, tema, tipografia e grade do seu jeito.",
  },
  {
    titulo: "Sem limite de download",
    texto: "A galeria é do seu cliente. Ele baixa quantas fotos quiser, quantas vezes quiser.",
  },
];

export default function Home() {
  const foto = planos.filter((p) => p.segmento === "foto");
  const filme = planos.filter((p) => p.segmento === "filme");

  return (
    <main>
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-8">
        <span className="flex items-center gap-3">
          <MarcaTile tamanho={40} />
          <span className="text-lg font-bold tracking-tight">{marca.nome}</span>
        </span>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/entrar" className="text-texto-soft hover:text-texto">
            Entrar
          </Link>
          <Link
            href="/cadastrar"
            className="rounded-full bg-luz px-4 py-2 font-medium text-void hover:bg-luz-alta"
          >
            Criar conta
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-3xl px-6 pb-20 pt-12 text-center sm:pt-20">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-texto-faint">
          Galerias de entrega
        </p>
        <h1 className="mt-4 font-serif text-4xl font-bold tracking-tight sm:text-6xl">
          {marca.tagline}
        </h1>
        <p className="mx-auto mt-6 max-w-[46ch] text-lg text-texto-soft">{marca.descricao}</p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/cadastrar"
            className="rounded-full bg-luz px-6 py-3 font-medium text-void hover:bg-luz-alta"
          >
            Criar conta grátis
          </Link>
          <Link
            href="#planos"
            className="text-sm text-texto-soft underline underline-offset-4 hover:text-texto"
          >
            Ver planos
          </Link>
        </div>
        <p className="mt-4 text-xs text-texto-faint">14 dias grátis, sem cartão.</p>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-24">
        <ul className="grid gap-px overflow-hidden rounded-2xl border border-linha bg-linha sm:grid-cols-2 lg:grid-cols-3">
          {RECURSOS.map((r) => (
            <li key={r.titulo} className="bg-carbon p-6">
              <h3 className="font-semibold">{r.titulo}</h3>
              <p className="mt-2 text-sm text-texto-soft">{r.texto}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="planos" className="mx-auto max-w-5xl scroll-mt-8 px-6 pb-24">
        <div className="text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-texto-faint">Planos</p>
          <h2 className="mt-3 font-serif text-3xl font-bold tracking-tight">
            Um plano pra cada tamanho de entrega
          </h2>
          <p className="mx-auto mt-3 max-w-[50ch] text-texto-soft">
            Todos incluem galeria com a sua marca, downloads ilimitados e cofre automático depois do
            prazo.
          </p>
        </div>

        <div className="mt-12 grid gap-10 sm:grid-cols-2">
          <PlanoGrupo titulo="Foto" planos={foto} />
          <PlanoGrupo titulo="Filme" planos={filme} />
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-24 text-center">
        <h2 className="font-serif text-2xl font-bold tracking-tight">Pronto pra entregar do seu jeito?</h2>
        <Link
          href="/cadastrar"
          className="mt-6 inline-block rounded-full bg-luz px-6 py-3 font-medium text-void hover:bg-luz-alta"
        >
          Criar conta grátis
        </Link>
      </section>

      <footer className="border-t border-linha px-6 py-10 text-center text-xs text-texto-faint">
        <p>
          <Link href="/privacidade" className="hover:text-texto-soft">
            Privacidade
          </Link>
          {" · "}
          <Link href="/termos" className="hover:text-texto-soft">
            Termos de uso
          </Link>
        </p>
        <p className="mt-2">
          {marca.nome} · {marca.email}
        </p>
        <p className="mt-1">© {new Date().getFullYear()}</p>
      </footer>
    </main>
  );
}

function PlanoGrupo({ titulo, planos }: { titulo: string; planos: Plano[] }) {
  return (
    <div>
      <h3 className="font-mono text-[11px] uppercase tracking-[0.28em] text-texto-faint">{titulo}</h3>
      <ul className="mt-4 divide-y divide-linha rounded-xl border border-linha">
        {planos.map((p) => (
          <li key={p.id} className="relative flex items-center justify-between gap-4 p-5">
            {p.destaque && (
              <span className="absolute -top-3 left-5 rounded-full bg-luz px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-void">
                Mais pedido
              </span>
            )}
            <div>
              <p className="font-semibold">{p.nome}</p>
              <p className="text-xs text-texto-soft">
                galeria + {p.cofreGb >= 1000 ? `${p.cofreGb / 1000} TB` : `${p.cofreGb} GB`} de cofre
              </p>
            </div>
            <p className="whitespace-nowrap text-lg font-bold text-luz-alta">
              {formatarReais(p.precoCentavos)}
              <span className="text-xs font-normal text-texto-faint">/mês</span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
