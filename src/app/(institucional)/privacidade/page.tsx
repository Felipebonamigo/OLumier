import type { Metadata } from "next";
import Link from "next/link";
import { marca } from "@/config/marca";
import { VERSOES_LEGAIS, dataPorExtenso, operadorPorExtenso } from "@/config/documentos-legais";
import { RETENCAO_POR_EXTENSO, TOTAL_DE_AVISOS } from "@/config/retencao";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: `Como a ${marca.nome} trata dados pessoais.`,
};

/**
 * Data da última revisão do texto — precisa mudar junto com o conteúdo. Mora em
 * `config/documentos-legais.ts` porque o cadastro grava a mesma versão como a
 * que a pessoa aceitou.
 *
 * ── CORREÇÃO DE 30/09/2026 ────────────────────────────────────────────────
 * Esta página ainda prometia "segunda cópia de todos os arquivos num provedor
 * diferente", um mês depois de o espelho ter sido cancelado (27/08/2026, ver
 * `scripts/testar-sem-espelho.mjs`). /seguranca e os Termos já diziam a
 * verdade — "seus originais têm UMA cópia" — e esta dizia o contrário. Em
 * disputa por arquivo perdido, é esta a frase que o outro lado cita.
 *
 * Também dizia que o registro de atividade não guarda e-mail nem nome, e ele
 * guardava os dois. `scripts/testar-textos-legais.mjs` segura as duas coisas.
 */
const ATUALIZADO_EM = dataPorExtenso(VERSOES_LEGAIS.privacidade);

export default function PrivacidadePage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-texto">Política de Privacidade</h1>
      <p className="mt-1 text-xs text-texto-faint">Atualizada em {ATUALIZADO_EM}</p>

      <p>
        Esta política explica quais dados a {marca.nome} coleta, por quê, e o que você pode fazer a
        respeito. Ela vale para duas pessoas diferentes: o <strong>fotógrafo</strong>, que contrata
        o serviço, e o <strong>visitante</strong>, que recebe um link e abre uma galeria.
      </p>

      <h2>Quem é o responsável</h2>
      <p>
        A {marca.nome} é operada por {operadorPorExtenso()}. Contato para qualquer assunto de
        privacidade, inclusive os pedidos descritos abaixo:{" "}
        <a href={marca.whatsappLink}>WhatsApp {marca.whatsappVisivel}</a>.
      </p>

      <h2>Dados do fotógrafo</h2>
      <ul>
        <li>
          <strong>Nome do estúdio e e-mail</strong> — para identificar a conta e enviar avisos sobre
          o serviço.
        </li>
        <li>
          <strong>Senha</strong> — guardada apenas como <em>hash</em> (scrypt). Não temos como ler
          sua senha, nem para te ajudar: se você perder, ela é substituída, nunca recuperada.
        </li>
        <li>
          <strong>CPF ou CNPJ</strong> — pedido no cadastro, para garantir um teste grátis por
          pessoa: não pode haver duas contas com o mesmo documento. É também o que vai na
          cobrança, quando você assina — o processador de pagamento exige para emiti-la.
        </li>
      </ul>

      <h2>Registro de atividade da conta</h2>
      <p>
        Guardamos um registro das ações importantes feitas na sua conta — criar conta, apagar ou
        restaurar uma galeria, apagar um arquivo, trocar de plano, cancelar a assinatura, trocar a
        senha. De cada uma fica guardado:
      </p>
      <ul>
        <li>qual ação, quando, e se partiu de você ou de uma rotina automática do sistema;</li>
        <li>o nome do estúdio, como estava no momento da ação;</li>
        <li>
          o que é preciso para o registro continuar fazendo sentido depois — por exemplo, o nome da
          galeria apagada e quantos arquivos ela tinha;
        </li>
        <li>
          o <strong>endereço IP em forma de hash</strong>, nunca o IP em si — mesma prática do
          registro de visitas.
        </li>
      </ul>
      <p>
        <strong>Por que isso existe:</strong> é o que permite responder &ldquo;o que aconteceu com
        a galeria X?&rdquo; quando alguém perde um trabalho e precisa saber se foi apagado por
        engano, se o prazo venceu, ou se houve falha nossa. Sem esse registro, ninguém consegue
        reconstruir o que ocorreu — nem você, nem nós.
      </p>
      <p>
        Esse registro <strong>não pode ser alterado nem apagado</strong>, nem por nós: o banco de
        dados recusa qualquer tentativa. É o que faz dele um registro confiável em vez de um
        rascunho. Por isso ele <strong>sobrevive ao encerramento da conta</strong> — a base legal é
        o exercício regular de direitos (art. 7º, VI e art. 16, I da LGPD). Senha, CPF ou CNPJ e
        conteúdo de foto nunca entram nele. O <strong>e-mail</strong>, quando precisa constar —
        para provar para qual endereço um aviso foi mandado —, entra só{" "}
        <strong>em forma de hash</strong>, como o IP: dá para conferir se um endereço bate, mas não
        dá para ler o endereço.
      </p>

      <h2>Dados dos visitantes das galerias</h2>
      <p>
        Quando alguém abre ou baixa fotos de uma galeria, registramos a ação para que o fotógrafo
        saiba que a entrega chegou. O que fica guardado:
      </p>
      <ul>
        <li>a ação (abriu, baixou uma foto, baixou tudo, assistiu) e quando;</li>
        <li>
          o <strong>endereço IP em forma de hash</strong> — nunca o IP em si. Serve para distinguir
          visitantes sem identificar ninguém;
        </li>
        <li>o navegador e sistema operacional informados pelo aparelho.</li>
      </ul>
      <p>
        Em algumas galerias o visitante <strong>se identifica</strong> — digitando o nome, o e-mail,
        ou os dois. Isso acontece quando ele escolhe fotos favoritas, quando baixa a entrega pela
        primeira vez e quando deixa um recado para o fotógrafo. É ele quem digita, e serve para uma
        coisa só: o fotógrafo saber de quem é cada escolha, cada download e cada recado. Não há
        senha, não há conta e não há confirmação — não é um cadastro.
      </p>
      <ul>
        <li>
          <strong>nome e e-mail</strong>, como a pessoa os escreveu, guardados dentro daquela
          galeria;
        </li>
        <li>
          as <strong>fotos marcadas</strong> como favoritas e o que foi baixado, ligados a essa
          identificação;
        </li>
        <li>
          o <strong>recado</strong>, quando o fotógrafo pede um — o texto, as notas e, se a pessoa
          marcar, a autorização para ele usar a frase como depoimento. Só o fotógrafo dono da
          galeria lê os recados.
        </li>
      </ul>
      <p>
        Nada disso é obrigatório: quem não quiser se identificar continua vendo a galeria inteira.
        Para sair, basta usar o <strong>“não sou eu”</strong> na própria galeria — ou pedir ao
        fotógrafo, que é o controlador desses dados. Quando a galeria é apagada, isso vai com ela.
      </p>
      <p>
        Não usamos rastreadores de publicidade, não temos pixel de rede social e não vendemos dado
        nenhum para ninguém.
      </p>

      <h2>As fotos e vídeos</h2>
      <p>
        O conteúdo enviado é <strong>do fotógrafo</strong>. Nós apenas armazenamos e entregamos. Não
        usamos as imagens para divulgação, não treinamos modelos com elas e não damos acesso a
        terceiros — salvo ordem judicial.
      </p>
      <p>
        Galerias não são indexadas por buscadores: toda página de galeria é servida com instrução
        explícita de não indexação, e as fotos são entregues por links temporários e assinados, que
        expiram.
      </p>

      <h2>Cookies</h2>
      <p>Usamos apenas o necessário para o serviço funcionar — nenhum cookie de publicidade:</p>
      <ul>
        <li>
          <strong>sessão do fotógrafo</strong> — mantém você logado no painel;
        </li>
        <li>
          <strong>liberação de galeria</strong> — depois de acertar a senha, evita pedir de novo a
          cada foto.
        </li>
      </ul>

      <h2>Com quem os dados são compartilhados</h2>
      <ul>
        <li>
          <strong>Backblaze</strong> — guarda os arquivos originais e, num espaço separado, o
          backup cifrado do banco de dados.
        </li>
        <li>
          <strong>Cloudflare</strong> — guarda as miniaturas e prévias que fazem a galeria abrir
          rápido, e responde pelo DNS.
        </li>
        <li>
          <strong>Asaas</strong> — processa os pagamentos. Recebe nome, e-mail e CPF/CNPJ de quem
          assina. Não temos acesso ao número do seu cartão.
        </li>
        <li>
          <strong>Hostinger</strong> — hospeda o servidor e o banco de dados.
        </li>
      </ul>

      <h2>Por quanto tempo guardamos</h2>
      <ul>
        <li>
          <strong>Enquanto a conta existir.</strong> Galeria que vence vai para o cofre: sai do ar,
          mas <em>nada é apagado</em> — é o comportamento contratado.
        </li>
        <li>
          <strong>Assinatura cancelada, ou pagamento em atraso</strong>: os arquivos ficam{" "}
          {RETENCAO_POR_EXTENSO} depois do fim do período pago, com {TOTAL_DE_AVISOS} avisos por
          e-mail antes, e então são apagados. A conta e os dados de cadastro continuam até você
          pedir a exclusão.
        </li>
        <li>
          <strong>Teste grátis que termina sem assinatura</strong>: os arquivos enviados durante o
          teste são apagados 60 dias depois do fim dele, com dois avisos por e-mail antes. A conta
          e os dados dela continuam, e você pode assinar quando quiser.
        </li>
        <li>
          <strong>Ao apagar uma galeria</strong>, ela vai para a lixeira e fica{" "}
          <strong>30 dias</strong> lá — nada é removido do armazenamento nesse período, e você pode
          restaurar tudo com um clique. Passado o prazo, os arquivos são apagados de vez — não
          existe outra cópia deles do nosso lado.
        </li>
        <li>
          <strong>Os dados de cadastro também estão no backup diário do banco</strong> (as fotos
          não). Esse backup é travado contra exclusão por 30 dias, numa modalidade que nós
          conseguimos destravar: um pedido de exclusão alcança o backup também.
        </li>
        <li>
          <strong>Ao encerrar a conta</strong>, os dados são apagados mediante pedido pelo{" "}
          <a href={marca.whatsappLink}>WhatsApp</a> — com a exceção do registro de atividade
          descrito acima, que é imutável por desenho.
        </li>
      </ul>

      <h2>Seus direitos (LGPD)</h2>
      <p>
        A Lei Geral de Proteção de Dados garante que você peça confirmação, acesso, correção,
        portabilidade, anonimização ou exclusão dos seus dados, e que revogue consentimento. Chame
        no <a href={marca.whatsappLink}>WhatsApp {marca.whatsappVisivel}</a> — respondemos em até 15
        dias.
      </p>
      <p>
        <strong>Se você aparece numa foto</strong> e quer que ela saia do ar, fale primeiro com o
        fotógrafo que fez a entrega: o conteúdo é dele e ele consegue remover na hora. Se não obtiver
        resposta, fale com a gente.
      </p>

      <h2>Segurança</h2>
      <p>
        Senhas com <em>hash</em>, tráfego sempre em HTTPS, links de arquivo temporários e assinados,
        limite de tentativas de senha. O armazenamento nunca é público: todo acesso a arquivo passa
        por link assinado de validade curta.
      </p>
      <p>
        Contra perda de dado: <strong>backup diário</strong> do banco, cifrado e com cópia fora do
        servidor, e a <strong>lixeira de 30 dias</strong>, que dá tempo de desfazer um apagar por
        engano. Os <strong>arquivos originais têm uma cópia só</strong>, em armazenamento
        profissional — não mantemos uma segunda cópia deles em outra empresa. Os detalhes estão na
        página de <Link href="/seguranca">segurança</Link>.
      </p>
      <p>
        Nenhum sistema é perfeito, e nós não fingimos que o nosso é. A {marca.nome} é serviço de
        entrega e de cofre — <strong>não substitui o seu backup</strong>, e nenhum serviço deveria
        ser a sua única cópia. Se descobrirmos um incidente que possa te afetar, avisamos.
      </p>

      <h2>Mudanças</h2>
      <p>
        Se esta política mudar de forma relevante, avisamos por e-mail antes de valer. A data no topo
        indica a última revisão.
      </p>
    </>
  );
}
