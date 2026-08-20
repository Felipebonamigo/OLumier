import type { Metadata } from "next";
import { marca } from "@/config/marca";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: `Como o ${marca.nome} trata dados pessoais.`,
};

/** Data da última revisão do texto — precisa mudar junto com o conteúdo. */
const ATUALIZADO_EM = "20 de agosto de 2026";

export default function PrivacidadePage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-texto">Política de Privacidade</h1>
      <p className="mt-1 text-xs text-texto-faint">Atualizada em {ATUALIZADO_EM}</p>

      <p>
        Esta política explica quais dados o {marca.nome} coleta, por quê, e o que você pode fazer a
        respeito. Ela vale para duas pessoas diferentes: o <strong>fotógrafo</strong>, que contrata
        o serviço, e o <strong>visitante</strong>, que recebe um link e abre uma galeria.
      </p>

      <h2>Quem é o responsável</h2>
      <p>
        O {marca.nome} é operado por Felipe Carboni Bonamigo. Contato para qualquer assunto de
        privacidade, inclusive os pedidos descritos abaixo: <a href={`mailto:${marca.email}`}>{marca.email}</a>.
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
          <strong>CPF ou CNPJ</strong> — pedido <em>somente</em> quando você ativa a assinatura,
          porque o processador de pagamento exige para emitir a cobrança. Quem usa o teste grátis
          nunca informa documento.
        </li>
      </ul>

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
          <strong>Cloudflare</strong> — armazena os arquivos e responde pelo DNS.
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
          <strong>Ao apagar uma galeria</strong>, os arquivos são removidos do armazenamento junto,
          e isso é definitivo.
        </li>
        <li>
          <strong>Ao encerrar a conta</strong>, os dados são apagados mediante pedido pelo e-mail
          acima.
        </li>
      </ul>

      <h2>Seus direitos (LGPD)</h2>
      <p>
        A Lei Geral de Proteção de Dados garante que você peça confirmação, acesso, correção,
        portabilidade, anonimização ou exclusão dos seus dados, e que revogue consentimento. Escreva
        para <a href={`mailto:${marca.email}`}>{marca.email}</a> — respondemos em até 15 dias.
      </p>
      <p>
        <strong>Se você aparece numa foto</strong> e quer que ela saia do ar, fale primeiro com o
        fotógrafo que fez a entrega: o conteúdo é dele e ele consegue remover na hora. Se não obtiver
        resposta, escreva para nós.
      </p>

      <h2>Segurança</h2>
      <p>
        Senhas com <em>hash</em>, tráfego sempre em HTTPS, links de arquivo temporários e assinados,
        limite de tentativas de senha, backup diário do banco com cópia fora do servidor. Nenhum
        sistema é perfeito; se descobrirmos um incidente que possa te afetar, avisamos.
      </p>

      <h2>Mudanças</h2>
      <p>
        Se esta política mudar de forma relevante, avisamos por e-mail antes de valer. A data no topo
        indica a última revisão.
      </p>
    </>
  );
}
