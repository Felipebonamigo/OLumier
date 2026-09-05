"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * O menu lateral da galeria.
 *
 * ── POR QUE A TELA FOI PARTIDA (04/09/2026) ────────────────────────────────
 *
 * A página empilhava onze seções, e o sócio resumiu: "a organização da criação
 * da galeria está confusa". Ele apontou o Pixieset, que separa em partes com
 * menu lateral.
 *
 * A divisão é a que ele descreveu — design (montagem e beleza), geral
 * (configurações de link e estrutura), atividade (quem baixa, quem favorita) —
 * mais Fotos, que é o trabalho em si e por isso é a aba padrão.
 *
 * São ROTAS, não abas de JavaScript, e a diferença é de custo: a página antiga
 * fazia oito consultas e assinava uma URL por foto antes de desenhar qualquer
 * coisa. Numa galeria de 600 fotos, 600 assinaturas para quem entrou só para
 * trocar a senha. Com rota por aba, cada uma carrega o que é dela — e o
 * endereço fica compartilhável e o botão voltar funciona, de graça.
 */

const ABAS = [
  {
    id: "fotos",
    nome: "Fotos",
    desc: "Enviar, organizar em capítulos",
    /* Traço da foto com a montanha — o mesmo desenho do ícone de imagem. */
    caminho: "M3 5.5h18v13H3zM3 15l5-4 4 3 3-3 6 5",
  },
  {
    id: "design",
    nome: "Design",
    desc: "Capa, letra, cor e grade",
    caminho: "M4 20h4L20 8a2.8 2.8 0 0 0-4-4L4 16zM14 6l4 4",
  },
  {
    id: "entrega",
    nome: "Entrega",
    desc: "Link, senha, prazo",
    caminho: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  },
  {
    id: "atividade",
    nome: "Atividade",
    desc: "Quem abriu, quem escolheu",
    caminho: "M3 17l5-6 4 3 4-6 5 5",
  },
] as const;

export function MenuGaleria({ galeriaId }: { galeriaId: string }) {
  const caminhoAtual = usePathname();

  return (
    <nav aria-label="Seções da galeria">
      {/*
        Rolagem horizontal no celular, coluna no computador.

        Menu lateral numa tela de 390 px comeria metade da largura útil. Ali ele
        vira uma fila de pastilhas que rola — o mesmo padrão que a própria
        galeria do cliente já usa para os capítulos.
      */}
      <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {ABAS.map((aba) => {
          const href = `/painel/galerias/${galeriaId}/${aba.id}`;
          /* `endsWith` e não igualdade: o Design tem sub-rotas (capa,
             tipografia, cor, grade) e a entrada precisa continuar marcada
             quando a pessoa está numa delas. */
          const ativa = caminhoAtual === href || caminhoAtual.startsWith(`${href}/`);
          return (
            <li key={aba.id} className="shrink-0 lg:shrink">
              <Link
                href={href}
                aria-current={ativa ? "page" : undefined}
                className={`flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition lg:whitespace-normal ${
                  ativa
                    ? "bg-carbon-2 font-medium text-texto"
                    : "text-texto-soft hover:bg-carbon hover:text-texto"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="17"
                  height="17"
                  aria-hidden="true"
                  className="shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: ativa ? "var(--acento)" : undefined }}
                >
                  <path d={aba.caminho} />
                </svg>
                <span className="min-w-0">
                  {aba.nome}
                  {/* A descrição só no computador: no celular a fila já é
                      apertada, e duas linhas por pastilha a quebrariam. */}
                  <span className="hidden truncate text-xs font-normal text-texto-faint lg:block">
                    {aba.desc}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
