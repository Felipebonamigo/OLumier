"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { salvarPublicacaoAction } from "@/app/painel/actions";
import { marca } from "@/config/marca";

/**
 * Controles de publicação: senha, download, e o ato de publicar.
 *
 * A ordem da seção é a ordem da decisão — ajustes em cima, publicar embaixo.
 * Publicado, o botão sai da frente e o LINK vira o assunto, porque a partir dali
 * o trabalho é mandá-lo para o cliente.
 */
export function PublicarGaleria({
  galeriaId,
  caminho,
  estudioSlug,
  galeriaSlug,
  publicada,
  temSenha,
  senhaVisivel,
  permiteDownload,
  semFotos,
}: {
  galeriaId: string;
  /** Caminho longo (/g/estudio/galeria) — usado fora de produção. */
  caminho: string;
  estudioSlug: string;
  galeriaSlug: string;
  publicada: boolean;
  temSenha: boolean;
  /** O que o fotógrafo digitou. `null` em senha anterior a 24/09/2026. */
  senhaVisivel: string | null;
  permiteDownload: boolean;
  /* Publicar galeria vazia é permitido — só não deve ser acidental. */
  semFotos: boolean;
}) {
  const [copiado, setCopiado] = useState(false);
  const [senha, setSenha] = useState("");
  const [mexeuNaSenha, setMexeuNaSenha] = useState(false);
  const [copiouSenha, setCopiouSenha] = useState(false);
  const [salvando, iniciar] = useTransition();
  const router = useRouter();

  /**
   * O domínio só é conhecido no navegador, mas ler `window` durante a render
   * quebraria a hidratação: o servidor mandaria "/g/..." e o cliente
   * "https://.../g/...", e o React reclamaria da diferença. Então a primeira
   * render (nos dois lados) mostra o caminho, e o domínio entra depois de montar.
   */
  const [origem, setOrigem] = useState("");
  const [endereco, setEndereco] = useState("");
  /* Mesmo caso do modo salvar em `galeria-cliente`, e o comentário acima explica
     por quê: o endereço só existe no navegador, e a alternativa seria o servidor
     adivinhar o domínio — que é exatamente o que quebrava a hidratação antes. */
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setOrigem(window.location.origin);
    setEndereco(window.location.hostname);
  }, []);

  /*
   * O ENDEREÇO DO ESTÚDIO é o link que o fotógrafo deve mandar.
   *
   * O subdomínio existe desde 19/08, mas o painel continuava entregando
   * `olumier.com.br/g/siriusfotografia/lu-marino` — então o fotógrafo copiava o
   * link feio, mandava no WhatsApp, e o recurso inteiro ficava sem uso.
   *
   * Só em produção: em `localhost` o subdomínio não resolve, e mostrar um link
   * que não abre durante o desenvolvimento seria pior que o caminho longo.
   */
  const emProducao = endereco.endsWith(marca.dominio);
  const linkCompleto = emProducao
    ? `https://${estudioSlug}.${marca.dominio}/${galeriaSlug}`
    : origem + caminho;

  function salvar(mudancas: FormData) {
    iniciar(async () => {
      await salvarPublicacaoAction(mudancas);
      setMexeuNaSenha(false);
      setSenha("");
      router.refresh();
    });
  }

  function alternar(campo: "publicada" | "permite_download", valor: boolean) {
    const f = new FormData();
    f.set("galeria_id", galeriaId);
    f.set(campo, valor ? "1" : "0");
    salvar(f);
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(linkCompleto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* clipboard bloqueado — o link continua visível na tela */
    }
  }

  return (
    <section className="mt-8 rounded-xl border border-linha bg-carbon p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Entrega ao cliente</h2>
        <span className={`text-xs font-medium ${publicada ? "text-ok" : "text-texto-faint"}`}>
          {publicada ? "no ar" : "rascunho"}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-texto-faint">
        {publicada
          ? "O link abre para quem tiver ele."
          : "Ajuste o que quiser e publique quando estiver pronto. Ninguém vê até lá."}
      </p>

      <label className="mt-4 flex items-start gap-3">
        <input
          type="checkbox"
          checked={permiteDownload}
          disabled={salvando}
          onChange={(e) => alternar("permite_download", e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[color:var(--acento)]"
        />
        <span>
          <span className="block text-sm font-medium">Permitir download</span>
          <span className="block text-xs text-texto-faint">
            Sem limite de vezes — não custa nada a mais.
          </span>
          {/*
            Dizer o alcance real em vez de deixar a pessoa supor que é blindagem.
            Desligado, o arquivo em resolução cheia deixa de ser entregue — mas a
            foto ainda precisa aparecer na tela, e o que está na tela sempre pode
            virar uma captura. Prometer "ninguém copia" seria mentira.
          */}
          {!permiteDownload && (
            <span className="mt-1 block text-xs text-texto-faint">
              Desligado, o botão de baixar some e o arquivo original não é mais
              entregue. Não impede print da tela nem salvar a imagem que aparece.
            </span>
          )}
        </span>
      </label>

      <div className="mt-5 border-t border-linha pt-5">
        <span className="block text-sm font-medium">
          Senha {temSenha ? <span className="text-xs font-normal text-ok">· definida</span> : null}
        </span>
        <p className="mt-0.5 text-xs text-texto-faint">
          {temSenha
            ? "Para trocar, digite outra. Para tirar, salve com o campo vazio."
            : "Opcional. O link já é secreto; a senha é uma tranca a mais."}
        </p>

        {/*
          ── A SENHA ATUAL, ESCRITA ──────────────────────────────────────────

          Juan, 24/09/2026: "ao colocar a senha, ela some e eu não sei mais qual
          a senha". Era o produto funcionando como projetado — só o hash era
          guardado —, e o projeto é que estava errado: o trabalho dele é CONTAR
          a senha ao casal, e relê-la um mês depois.

          Fica ao lado do botão de copiar porque é assim que ela é usada: o
          fotógrafo manda o link e a senha na mesma mensagem.
        */}
        {temSenha && senhaVisivel && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-linha bg-void px-3 py-2">
            <span className="text-xs text-texto-faint">senha atual</span>
            <code className="flex-1 font-mono text-sm text-texto">{senhaVisivel}</code>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(senhaVisivel);
                  setCopiouSenha(true);
                  setTimeout(() => setCopiouSenha(false), 2000);
                } catch {
                  /* Sem área de transferência (http sem TLS, navegador embutido):
                     a senha já está na tela, então basta ler e digitar. */
                  prompt("Copie a senha:", senhaVisivel);
                }
              }}
              className="rounded-md border border-linha px-2.5 py-1 text-xs text-texto-soft transition hover:border-acento hover:text-texto"
            >
              {copiouSenha ? "copiada ✓" : "copiar"}
            </button>
          </div>
        )}

        {/* A senha definida antes de 24/09/2026 existe só como hash, e hash não
            volta atrás. Dizer isso é melhor que deixar o fotógrafo procurando
            um botão de "mostrar" que não existiria. */}
        {temSenha && !senhaVisivel && (
          <p className="mt-2 rounded-lg border border-linha bg-void px-3 py-2 text-xs leading-relaxed text-texto-soft">
            Esta senha foi definida antes de o sistema passar a guardá-la de forma legível, e não
            dá para mostrá-la. Ela continua funcionando — se você não lembra qual é, defina uma
            nova aqui embaixo. Quem já recebeu a antiga vai precisar da nova.
          </p>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          <input
            type="text"
            value={senha}
            onChange={(e) => {
              setSenha(e.target.value);
              setMexeuNaSenha(true);
            }}
            placeholder={temSenha ? "nova senha" : "ex.: anaepedro"}
            className="min-w-0 flex-1 rounded-lg border border-linha bg-void px-3 py-2 text-sm placeholder:text-exemplo focus:border-acento focus:outline-none"
          />
          <button
            type="button"
            disabled={salvando || !mexeuNaSenha}
            onClick={() => {
              const f = new FormData();
              f.set("galeria_id", galeriaId);
              f.set("senha", senha);
              f.set("mexeu_senha", "1");
              salvar(f);
            }}
            className="rounded-lg border border-linha-forte px-4 py-2 text-sm transition hover:bg-carbon-2 disabled:opacity-40"
          >
            Salvar
          </button>
        </div>
      </div>

      {/*
        PUBLICAR É UM ATO, NÃO UM AJUSTE.

        Era uma caixa "Galeria publicada" no topo da seção, junto com download e
        senha — três marcações iguais, e a única que muda o mundo lá fora
        misturada às duas que só configuram. Caixa marcada descreve um estado;
        botão faz uma coisa. E ela ficava ANTES dos ajustes, sugerindo publicar
        primeiro e arrumar depois — o contrário da ordem que a pessoa quer.

        Agora os ajustes vêm em cima e a decisão embaixo, que é onde ela cabe:
        depois de tudo pronto. Publicado, o botão sai da frente e o LINK vira o
        assunto, porque a partir dali o trabalho é mandá-lo.
      */}
      <div className="mt-5 border-t border-linha pt-5">
        {!publicada ? (
          <>
            {semFotos && (
              <p className="mb-3 rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-xs text-alerta">
                Esta galeria ainda não tem foto nenhuma. Dá para publicar assim mesmo — o cliente
                abriria uma galeria vazia.
              </p>
            )}
            <button
              type="button"
              disabled={salvando}
              onClick={() => alternar("publicada", true)}
              className="w-full rounded-lg bg-acento px-4 py-2.5 text-sm font-semibold text-void transition hover:bg-acento-alto disabled:opacity-40"
            >
              {salvando ? "Publicando…" : "Publicar galeria"}
            </button>
            <p className="mt-2 text-center text-xs text-texto-faint">
              A partir daí o link abre para quem tiver ele. Dá para tirar do ar depois.
            </p>
          </>
        ) : (
          <>
            <span className="block text-sm font-medium">Link do cliente</span>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-linha bg-void px-3 py-2 text-xs text-texto-soft">
                {linkCompleto}
              </code>
              <button
                type="button"
                onClick={copiar}
                className="rounded-lg bg-acento px-4 py-2 text-sm font-semibold text-void transition hover:bg-acento-alto"
              >
                {copiado ? "copiado ✓" : "copiar"}
              </button>
              {/* Abre o MESMO link que ele vai mandar — conferir outro endereço
                  não provaria que o link entregue funciona. O caminho longo cobre
                  a primeira render, antes de o navegador informar o domínio. */}
              <a
                href={linkCompleto || caminho}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-linha-forte px-4 py-2 text-sm transition hover:bg-carbon-2"
              >
                abrir ↗
              </a>
            </div>

            {/* Discreto de propósito: tirar do ar é raro, e vem depois do link
                porque o assunto de uma galeria publicada é entregá-la. */}
            <button
              type="button"
              disabled={salvando}
              onClick={() => alternar("publicada", false)}
              className="mt-3 text-xs text-texto-faint underline underline-offset-4 transition hover:text-erro disabled:opacity-40"
            >
              tirar do ar
            </button>
          </>
        )}
      </div>
    </section>
  );
}
