import type { ReactNode } from "react";
import {
  PLATAFORMAS,
  type Plataforma,
  type PlataformaDeOrigem,
} from "@/config/plataformas-de-origem";

/**
 * VINDO DE OUTRA PLATAFORMA — os dois caminhos de cada uma, e qual recomendamos.
 *
 * ── A DECISÃO (30/09/2026) ────────────────────────────────────────────────
 *
 * Felipe: "crie a opção de migração do pixieset, com login e senha, mas avise
 * dos riscos, e que o recomendado é colocar o zip" — e depois, para quem vem
 * do Pixellu: "crie a opção Login com a conta do Pixellu, igual foi feito para
 * o pixieset, só eu posso habilitar pelo menu admin".
 *
 * O caminho do ZIP funciona hoje, pela importação logo acima: as duas
 * plataformas deixam baixar a galeria em tamanho original, e a importação lê
 * os ZIPs direto no navegador.
 *
 * O caminho do login NÃO ESTÁ LIGADO em nenhuma das duas, e a tela diz isso em
 * vez de oferecer um botão que não faz nada (princípio 4 do PRODUCT.md):
 *
 *   · nenhuma das duas tem API pública nem integração oficial — entrar na
 *     conta do fotógrafo significa imitar o navegador dele, por endereços
 *     internos que elas não publicam;
 *   · o ambiente onde isto foi construído não alcança nenhuma das duas, então
 *     não havia como mapear nem testar nada contra o serviço de verdade.
 *
 * Ligar exige, para cada uma: a decisão dos sócios (com leitura jurídica dos
 * termos), uma conta real para mapear o login e o download, e uma máquina à
 * parte para copiar — o arquivo não pode passar pelo VPS. Ver
 * docs/importacao.md.
 *
 * ── SÓ PARA AS CONTAS APONTADAS ──────────────────────────────────────────
 *
 * Quem libera é o admin, no botão "Permitir <plataforma>" da ficha do estúdio
 * (migrações 051 e 053). Este componente só recebe se ESTA conta foi liberada
 * em cada uma. O formulário só acende com as duas travas abertas — conta
 * liberada E conector pronto (`config/plataformas-de-origem.ts`).
 */

/** O passo a passo do ZIP e os riscos do login, no idioma de cada plataforma. */
const TEXTOS: Record<Plataforma, { passos: ReactNode[]; riscoDaConta: ReactNode; senha: string }> = {
  pixieset: {
    passos: [
      "No Pixieset, abra a coleção e use o download da coleção inteira.",
      "Marque todos os sets e escolha o tamanho original.",
      "Coleção grande vem dividida em mais de um ZIP. Baixe todos: as partes se juntam numa galeria só.",
      "Solte os ZIPs na importação acima — pode ser de várias coleções de uma vez. Cada coleção vira uma galeria; se o ZIP trouxer os sets em pastas, cada set vira um capítulo.",
    ],
    riscoDaConta: (
      <>
        O Pixieset não tem integração oficial. Copiar pela sua conta significa entrar nela como se
        fosse você, por caminhos internos que eles não publicam — e os termos de uso deles não
        permitem esse tipo de acesso.
      </>
    ),
    senha: "Ela abre tudo no Pixieset: clientes, pagamentos, contratos.",
  },
  pixellu: {
    passos: [
      "Ainda tem as fotos no computador (onde você monta os álbuns no SmartAlbums, por exemplo)? Escolha a pasta do acervo na importação acima: cada subpasta vira uma galeria, sem baixar nada.",
      "Se as fotos só estão no Pixellu: abra a galeria e, no menu dela, use o download de todas as imagens, em resolução original. O download precisa estar ligado na galeria.",
      "Solte os ZIPs na importação acima — pode ser de várias galerias de uma vez. Cada galeria vira uma galeria aqui; se o ZIP trouxer as seções em pastas, cada seção vira um capítulo.",
    ],
    riscoDaConta: (
      <>
        O Pixellu não tem integração oficial. Copiar pela sua conta significa entrar nela como se
        fosse você, por caminhos internos que eles não publicam — e serviços assim costumam proibir
        esse tipo de acesso nos termos de uso.
      </>
    ),
    senha: "A mesma conta abre as suas galerias, os seus álbuns e o que você paga ao Pixellu.",
  },
};

export function MigrarDeOutraPlataforma({
  liberadas,
}: {
  /** Em quais plataformas ESTA conta foi liberada no admin. */
  liberadas: Record<Plataforma, boolean>;
}) {
  return (
    <section
      aria-labelledby="titulo-outras-plataformas"
      className="mt-8 rounded-xl border border-linha bg-carbon p-4 sm:p-5"
    >
      <h2 id="titulo-outras-plataformas" className="text-sm font-semibold">
        Vindo de outra plataforma?
      </h2>
      <p className="mt-0.5 text-xs text-texto-faint">
        Em todas, o caminho recomendado é o mesmo: baixar em tamanho original e soltar aqui em cima.
      </p>

      <div className="mt-4 flex flex-col gap-6">
        {PLATAFORMAS.map((p) => (
          <DaPlataforma key={p.id} plataforma={p} liberado={liberadas[p.id]} />
        ))}
      </div>
    </section>
  );
}

function DaPlataforma({ plataforma: p, liberado }: { plataforma: PlataformaDeOrigem; liberado: boolean }) {
  const texto = TEXTOS[p.id];
  const habilitado = liberado && p.conectorPronto;

  return (
    <div id={`vindo-do-${p.id}`}>
      <h3 className="text-sm font-semibold">{p.nome}</h3>

      <div className="mt-2 rounded-lg border border-acento/40 bg-acento/5 p-4">
        <p className="text-sm font-medium">Recomendado: baixe os ZIPs e solte aqui em cima</p>
        <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm text-texto-soft">
          {texto.passos.map((passo, i) => (
            <li key={i}>{passo}</li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-texto-faint">
          Não precisa descompactar: os ZIPs são lidos direto no navegador. Sua senha do {p.nome} não
          passa por aqui, e nada depende de o {p.nome} mudar alguma coisa.
        </p>
      </div>

      <details className="mt-3 rounded-lg border border-linha p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Entrar com a conta do {p.nome} <span className="text-texto-faint">(não recomendado)</span>
        </summary>

        <div className="mt-3 rounded-lg border border-alerta/40 bg-alerta/10 p-3">
          <p className="text-sm font-medium text-alerta">Os riscos, antes de qualquer coisa</p>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-texto-soft">
            <li>
              <strong className="text-texto">Sua conta do {p.nome} pode ser bloqueada.</strong>{" "}
              {texto.riscoDaConta} Se bloquearem no meio da migração, as galerias que seus clientes
              ainda usam lá saem do ar.
            </li>
            <li>
              <strong className="text-texto">Sua senha passaria pelo nosso sistema.</strong>{" "}
              {texto.senha} Mesmo sem guardá-la, ela precisaria trafegar até aqui.
            </li>
            <li>
              <strong className="text-texto">Pode parar de funcionar sem aviso</strong>, no dia em
              que o {p.nome} mudar algo por dentro.
            </li>
            <li>Quem usa verificação em duas etapas no {p.nome} não conseguiria entrar por aqui.</li>
          </ul>
        </div>

        {!habilitado && (
          <p className="mt-3 text-sm">
            <strong>Ainda não está disponível.</strong>{" "}
            <span className="text-texto-soft">
              {liberado
                ? `Sua conta está liberada para este caminho, mas ele ainda precisa ser mapeado com uma conta de verdade do ${p.nome} antes de ser ligado.`
                : "Por enquanto, só para contas liberadas pela nossa equipe."}{" "}
              Enquanto isso, os ZIPs trazem tudo do mesmo jeito — e sem nenhum desses riscos.
            </span>
          </p>
        )}

        <fieldset
          disabled={!habilitado}
          className={`mt-4 flex max-w-md flex-col gap-3 ${habilitado ? "" : "opacity-60"}`}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-texto-soft">E-mail do {p.nome}</span>
            <input
              type="email"
              autoComplete="off"
              className="rounded-lg border border-linha bg-void px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-texto-soft">Senha do {p.nome}</span>
            <input
              type="password"
              autoComplete="off"
              className="rounded-lg border border-linha bg-void px-3 py-2 text-sm"
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-texto-soft">
            <input type="checkbox" className="mt-1" />
            <span>Li os riscos acima e quero usar a minha conta do {p.nome} mesmo assim.</span>
          </label>
          <button
            type="button"
            className="self-start rounded-lg border border-linha-forte px-4 py-2 text-sm"
          >
            {habilitado ? `Entrar no ${p.nome}` : "Ainda não disponível"}
          </button>
        </fieldset>
      </details>
    </div>
  );
}
