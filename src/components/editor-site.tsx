"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { salvarSiteAction, type EstadoSite } from "@/app/painel/actions";
import { Area, Campo, Erro, Selecao, BotaoEnviar } from "@/components/form-ui";
import { OPCOES } from "@/config/aparencia";
import { LIMITES, MAX_DEPOIMENTOS, type Depoimento, type Site } from "@/lib/site-estudio";

function Botao({ ligado }: { ligado: boolean }) {
  const { pending } = useFormStatus();
  return <BotaoEnviar carregando={pending}>{ligado ? "Salvar e publicar" : "Salvar"}</BotaoEnviar>;
}

/**
 * O editor do site do estúdio.
 *
 * Campos fixos, e não blocos que se arrastam: ver o porquê no cabeçalho de
 * `src/lib/site-estudio.ts`. A consequência aqui é boa — o formulário tem a
 * mesma ordem da página, então o fotógrafo lê de cima para baixo e sabe onde
 * cada coisa vai sair.
 *
 * Tudo mora num `<form>` só, com uma gravação só. A alternativa (salvar seção a
 * seção) teria dado cinco botões e cinco chances de sair da tela com metade
 * gravada.
 */
export function EditorSite({
  site,
  galerias,
  endereco,
}: {
  site: Site;
  /** Galerias públicas — a capa do site sai de uma delas. */
  galerias: { slug: string; titulo: string }[];
  /** Endereço público da vitrine, para o link de conferir. */
  endereco: string;
}) {
  const [estado, action] = useActionState<EstadoSite, FormData>(salvarSiteAction, {});
  const [ligado, setLigado] = useState(site.ligado);
  const [sobre, setSobre] = useState(site.sobre);
  const [contatoTexto, setContatoTexto] = useState(site.contatoTexto);
  const [depoimentos, setDepoimentos] = useState<Depoimento[]>(site.depoimentos);

  const mudarDepoimento = (i: number, campo: keyof Depoimento, valor: string) =>
    setDepoimentos((atual) => atual.map((d, j) => (j === i ? { ...d, [campo]: valor } : d)));

  return (
    <form action={action} className="mt-6 space-y-6">
      {/* --- publicar ------------------------------------------------------ */}
      <section className="rounded-xl border border-linha bg-carbon p-5">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="ligado"
            checked={ligado}
            onChange={(e) => setLigado(e.target.checked)}
            className="mt-0.5 size-4 accent-acento"
          />
          <span>
            <span className="block text-sm font-medium">Site publicado</span>
            <span className="mt-0.5 block text-xs text-texto-faint">
              Enquanto estiver desligado, o seu endereço mostra só a capa e a lista de galerias —
              como sempre mostrou. Você escreve em paz e publica quando quiser.
            </span>
          </span>
        </label>

        <p className="mt-4 text-xs text-texto-faint">
          Seu endereço:{" "}
          <a
            href={endereco}
            target="_blank"
            rel="noreferrer"
            className="text-acento underline underline-offset-4"
          >
            {endereco.replace(/^https?:\/\//, "")} ↗
          </a>
        </p>
      </section>

      {/* --- capa --------------------------------------------------------- */}
      <section className="space-y-4 rounded-xl border border-linha bg-carbon p-5">
        <h2 className="text-sm font-semibold">Capa</h2>

        <Campo
          label="Frase de abertura"
          name="frase"
          defaultValue={site.frase}
          maxLength={LIMITES.frase}
          placeholder="Fotografia com cor e vida."
          dica="Aparece embaixo do nome do estúdio. Também é o texto que sai no Google e no WhatsApp."
        />

        <Campo
          label="Selo"
          name="selo"
          defaultValue={site.selo}
          maxLength={LIMITES.selo}
          placeholder="Agenda 2027 aberta"
          dica="Um aviso curto no topo, na sua cor. Deixe em branco para não mostrar."
        />

        {/*
         * A foto da capa sai de uma galeria publicada, não de um envio à parte.
         * Assim ela nunca envelhece parada: trocar a capa do site é trocar a
         * capa de uma galeria, coisa que o fotógrafo já faz.
         */}
        <Selecao label="Foto da capa" name="capaGaleria" defaultValue={site.capaGaleria}>
          <option value="">A galeria mais recente</option>
          {galerias.map((g) => (
            <option key={g.slug} value={g.slug}>
              A capa de “{g.titulo}”
            </option>
          ))}
        </Selecao>
        {galerias.length === 0 && (
          <p className="text-xs text-texto-faint">
            Você ainda não tem galeria publicada sem senha — por isso a capa fica só com o texto.
          </p>
        )}
      </section>

      {/* --- sobre -------------------------------------------------------- */}
      <section className="space-y-4 rounded-xl border border-linha bg-carbon p-5">
        <h2 className="text-sm font-semibold">Sobre</h2>

        <Campo
          label="Título da seção"
          name="sobreTitulo"
          defaultValue={site.sobreTitulo}
          maxLength={LIMITES.sobreTitulo}
        />

        <Area
          label="Texto"
          name="sobre"
          value={sobre}
          onChange={(e) => setSobre(e.target.value)}
          limite={LIMITES.sobre}
          maxLength={LIMITES.sobre}
          rows={9}
          placeholder="Quem é você, o que fotografa, como trabalha."
          dica="Deixe uma linha em branco entre os parágrafos. Vazio, a seção inteira não aparece."
        />

        <Campo
          label="Citação"
          name="citacao"
          defaultValue={site.citacao}
          maxLength={LIMITES.citacao}
          placeholder="Mas as coisas findas, muito mais que lindas, essas ficarão."
          dica="Sai em destaque, no fim do texto. As aspas nós desenhamos."
        />
        <Campo
          label="De quem é a citação"
          name="citacaoAutor"
          defaultValue={site.citacaoAutor}
          maxLength={LIMITES.citacaoAutor}
          placeholder="Carlos Drummond de Andrade"
        />
      </section>

      {/* --- depoimentos -------------------------------------------------- */}
      <section className="space-y-4 rounded-xl border border-linha bg-carbon p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Depoimentos</h2>
          <span className="font-mono text-[11px] tabular-nums text-texto-faint">
            {depoimentos.length}/{MAX_DEPOIMENTOS}
          </span>
        </div>

        <Campo
          label="Título da seção"
          name="depoimentosTitulo"
          defaultValue={site.depoimentosTitulo}
          maxLength={LIMITES.depoimentosTitulo}
        />

        {/*
         * A lista vai para o servidor como JSON num campo escondido. Um campo
         * numerado por depoimento (`depoimento_0_texto`…) obrigaria a reindexar
         * tudo a cada remoção, e é assim que some o depoimento errado.
         */}
        <input type="hidden" name="depoimentos" value={JSON.stringify(depoimentos)} />

        {depoimentos.length === 0 ? (
          <p className="text-xs text-texto-faint">
            Nenhum ainda — sem depoimento, a seção não aparece no site.
          </p>
        ) : (
          <ul className="space-y-3">
            {depoimentos.map((d, i) => (
              <li key={i} className="rounded-lg border border-linha bg-void p-3">
                <textarea
                  value={d.texto}
                  onChange={(e) => mudarDepoimento(i, "texto", e.target.value)}
                  maxLength={LIMITES.depoimentoTexto}
                  rows={3}
                  placeholder="O que o casal escreveu"
                  className="w-full resize-y rounded-md border border-linha bg-carbon px-3 py-2 text-sm leading-relaxed text-texto placeholder:text-exemplo focus:border-acento focus:outline-none"
                />
                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={d.autor}
                    onChange={(e) => mudarDepoimento(i, "autor", e.target.value)}
                    maxLength={LIMITES.depoimentoAutor}
                    placeholder="Ana & Pedro"
                    className="min-w-0 flex-1 rounded-md border border-linha bg-carbon px-3 py-2 text-sm text-texto placeholder:text-exemplo focus:border-acento focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setDepoimentos((a) => a.filter((_, j) => j !== i))}
                    className="shrink-0 rounded-md border border-linha px-3 py-2 text-xs text-texto-soft transition hover:border-erro/50 hover:text-erro"
                  >
                    Remover
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {depoimentos.length < MAX_DEPOIMENTOS && (
          <button
            type="button"
            onClick={() => setDepoimentos((a) => [...a, { texto: "", autor: "" }])}
            className="rounded-lg border border-linha px-3 py-2 text-sm text-texto-soft transition hover:bg-carbon-2 hover:text-texto"
          >
            + Adicionar depoimento
          </button>
        )}
      </section>

      {/* --- contato ------------------------------------------------------ */}
      <section className="space-y-4 rounded-xl border border-linha bg-carbon p-5">
        <h2 className="text-sm font-semibold">Contato</h2>

        <Campo
          label="Título da seção"
          name="contatoTitulo"
          defaultValue={site.contatoTitulo}
          maxLength={LIMITES.contatoTitulo}
        />

        <Area
          label="Texto"
          name="contatoTexto"
          value={contatoTexto}
          onChange={(e) => setContatoTexto(e.target.value)}
          limite={LIMITES.contatoTexto}
          maxLength={LIMITES.contatoTexto}
          rows={5}
          placeholder="Como funciona o orçamento, o que você precisa saber para responder."
        />

        <Campo
          label="WhatsApp"
          name="whatsapp"
          defaultValue={site.whatsapp}
          placeholder="(54) 99999-8888"
          dica="Vira o botão principal do contato. Pode digitar com parênteses e traço."
        />
        <Campo
          label="Instagram"
          name="instagram"
          defaultValue={site.instagram}
          placeholder="sirius.fotografia"
          dica="Só o usuário, sem @. Pode colar o endereço inteiro que a gente limpa."
        />
        <Campo
          label="E-mail de contato"
          name="email"
          type="email"
          defaultValue={site.email}
          maxLength={LIMITES.email}
          placeholder="contato@seuestudio.com.br"
          dica="Aparece no site para qualquer visitante — não precisa ser o e-mail de entrar aqui."
        />
      </section>

      {/* --- estilo ------------------------------------------------------- */}
      <section className="space-y-4 rounded-xl border border-linha bg-carbon p-5">
        <h2 className="text-sm font-semibold">Estilo</h2>
        <p className="text-xs text-texto-faint">
          Os mesmos ajustes que existem na galeria. A sua cor de destaque vem da Conta.
        </p>

        <Selecao label="Tema" name="tema" defaultValue={site.tema}>
          {OPCOES.tema.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nome} — {o.desc}
            </option>
          ))}
        </Selecao>

        <Selecao label="Tipografia" name="tipografia" defaultValue={site.tipografia}>
          {OPCOES.tipografia.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nome} — {o.desc}
            </option>
          ))}
        </Selecao>
      </section>

      <Erro mensagem={estado.erro} />
      {estado.ok && (
        <p role="status" className="text-sm text-ok">
          {estado.ok}
        </p>
      )}

      <Botao ligado={ligado} />
    </form>
  );
}
