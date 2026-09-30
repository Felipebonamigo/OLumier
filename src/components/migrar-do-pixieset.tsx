/**
 * VINDO DO PIXIESET — os dois caminhos, e qual recomendamos.
 *
 * ── A DECISÃO (30/09/2026) ────────────────────────────────────────────────
 *
 * Felipe: "crie a opção de migração do pixieset, com login e senha, mas avise
 * dos riscos, e que o recomendado é colocar o zip".
 *
 * O caminho do ZIP funciona hoje, pela importação logo acima: o Pixieset gera
 * o ZIP da coleção em tamanho original, e a importação lê os ZIPs direto no
 * navegador.
 *
 * O caminho do login NÃO ESTÁ LIGADO, e a tela diz isso em vez de oferecer um
 * botão que não faz nada (princípio 4 do PRODUCT.md). O motivo é concreto:
 *
 *   · o Pixieset não tem API pública nem integração oficial — entrar na conta
 *     do fotógrafo significa imitar o navegador dele, por endereços internos
 *     que eles não publicam e que os termos deles proíbem usar;
 *   · a única documentação que existe é de terceiros, feita por engenharia
 *     reversa, e não descreve o login nem o download do original;
 *   · o ambiente onde isto foi construído não alcança o Pixieset, então não
 *     havia como mapear nem testar nada contra o serviço de verdade.
 *
 * Ligar exige, nessa ordem: a decisão dos sócios (com leitura jurídica dos
 * termos do Pixieset), uma conta real para mapear o login e o download, e uma
 * máquina à parte para copiar — o arquivo não pode passar pelo VPS. Ver
 * docs/importacao.md.
 */
export function MigrarDoPixieset() {
  return (
    <section aria-labelledby="titulo-pixieset" className="mt-8 rounded-xl border border-linha bg-carbon p-4 sm:p-5">
      <h2 id="titulo-pixieset" className="text-sm font-semibold">
        Vindo do Pixieset?
      </h2>

      <div className="mt-3 rounded-lg border border-acento/40 bg-acento/5 p-4">
        <p className="text-sm font-medium">Recomendado: baixe os ZIPs e solte aqui em cima</p>
        <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm text-texto-soft">
          <li>No Pixieset, abra a coleção e use o download da coleção inteira.</li>
          <li>Marque todos os sets e escolha o tamanho original.</li>
          <li>
            Coleção grande vem dividida em mais de um ZIP. Baixe todos: as partes se juntam numa
            galeria só.
          </li>
          <li>
            Solte os ZIPs na importação acima — pode ser de várias coleções de uma vez. Cada coleção
            vira uma galeria; se o ZIP trouxer os sets em pastas, cada set vira um capítulo.
          </li>
        </ol>
        <p className="mt-2 text-xs text-texto-faint">
          Não precisa descompactar: os ZIPs são lidos direto no navegador. Sua senha do Pixieset não
          passa por aqui, e nada depende de o Pixieset mudar alguma coisa.
        </p>
      </div>

      <details className="mt-4 rounded-lg border border-linha p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Entrar com a conta do Pixieset <span className="text-texto-faint">(não recomendado)</span>
        </summary>

        <div className="mt-3 rounded-lg border border-alerta/40 bg-alerta/10 p-3">
          <p className="text-sm font-medium text-alerta">Os riscos, antes de qualquer coisa</p>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-texto-soft">
            <li>
              <strong className="text-texto">Sua conta do Pixieset pode ser bloqueada.</strong> O
              Pixieset não tem integração oficial. Copiar pela sua conta significa entrar nela como
              se fosse você, por caminhos internos que eles não publicam — e os termos de uso deles
              não permitem esse tipo de acesso. Se bloquearem no meio da migração, as galerias que
              seus clientes ainda usam lá saem do ar.
            </li>
            <li>
              <strong className="text-texto">Sua senha passaria pelo nosso sistema.</strong> Ela
              abre tudo no Pixieset: clientes, pagamentos, contratos. Mesmo sem guardá-la, ela
              precisaria trafegar até aqui.
            </li>
            <li>
              <strong className="text-texto">Pode parar de funcionar sem aviso</strong>, no dia em
              que o Pixieset mudar algo por dentro.
            </li>
            <li>Quem usa verificação em duas etapas no Pixieset não conseguiria entrar por aqui.</li>
          </ul>
        </div>

        <p className="mt-3 text-sm">
          <strong>Ainda não está disponível.</strong>{" "}
          <span className="text-texto-soft">
            Este caminho precisa ser mapeado com uma conta de verdade do Pixieset antes de ser
            ligado. Enquanto isso, os ZIPs trazem tudo do mesmo jeito — e sem nenhum desses riscos.
          </span>
        </p>

        <fieldset disabled className="mt-4 flex max-w-md flex-col gap-3 opacity-60">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-texto-soft">E-mail do Pixieset</span>
            <input
              type="email"
              autoComplete="off"
              className="rounded-lg border border-linha bg-void px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-texto-soft">Senha do Pixieset</span>
            <input
              type="password"
              autoComplete="off"
              className="rounded-lg border border-linha bg-void px-3 py-2 text-sm"
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-texto-soft">
            <input type="checkbox" className="mt-1" />
            <span>Li os riscos acima e quero usar a minha conta do Pixieset mesmo assim.</span>
          </label>
          <button
            type="button"
            className="self-start rounded-lg border border-linha-forte px-4 py-2 text-sm"
          >
            Ainda não disponível
          </button>
        </fieldset>
      </details>
    </section>
  );
}
