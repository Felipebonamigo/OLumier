-- CHAVE DE API POR ESTÚDIO — a porta para quem não é navegador.
--
-- Toda rota até aqui se autoriza por `sessaoAtual()`, que lê um cookie assinado.
-- Isso serve para o painel e não serve para mais nada: um plugin do Lightroom
-- (Lua) não faz login de navegador, não guarda cookie e não sobrevive à
-- expiração dele. Ver docs/chave-de-api.md para o desenho inteiro.
--
-- ── O SEGREDO NÃO MORA AQUI ────────────────────────────────────────────────
-- `hash` é SHA-256 do segredo inteiro; o segredo em si aparece UMA vez, na tela,
-- no momento da criação, e nunca mais. Um dump deste banco não pode virar acesso
-- às galerias de ninguém — é a mesma promessa que a página de segurança faz
-- sobre os arquivos, e ela não pode ter exceção na tabela de credenciais.
--
-- Por que SHA-256 e não scrypt, que é o que `auth.ts` usa para SENHA: senha é
-- escolhida por gente e tem pouca entropia, então o hash precisa ser lento para
-- o ataque de dicionário não compensar. Chave aqui é 32 bytes aleatórios — não
-- existe dicionário. Hash lento só adicionaria latência a TODA requisição do
-- plugin, que é justamente o caminho quente do upload.
--
-- ── POR QUE UM PREFIXO EM TEXTO CLARO ──────────────────────────────────────
-- `prefixo` é a parte não secreta da chave (`ga_a1b2c3`) e existe por dois
-- motivos: achar a linha por índice em vez de comparar hash contra a tabela
-- inteira, e deixar a chave reconhecível quando cair num log ou num print.
--
-- O prefixo é `ga_`, de Galeria Átomo, e é DECISÃO FECHADA: chave já
-- distribuída não muda de prefixo sem quebrar quem a usa. Se a plataforma
-- trocar de nome de novo, o prefixo NÃO acompanha — ele entra na mesma lista de
-- identificadores que a troca de marca não arrasta, junto com nome de bucket e
-- prefixo do Asaas. Ver src/config/marca.ts.

create table if not exists chaves_api (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  -- Escrito pelo fotógrafo: "Lightroom do notebook". Serve para ele saber qual
  -- revogar quando trocar de máquina — sem isso, revogar vira adivinhação.
  nome          text not null,
  prefixo       text not null,
  hash          text not null,
  escopo        text not null default 'envio',
  -- Nulo até o primeiro uso. É o que deixa o fotógrafo ver chave esquecida
  -- (nunca usada) e chave viva que ele não reconhece (usada ontem).
  ultimo_uso_em timestamptz,
  criada_em     timestamptz not null default now(),
  revogada_em   timestamptz,

  -- O escopo é conferido na conferência da chave, não em cada rota. O `check`
  -- existe porque escopo inválido gravado por engano viraria chave que não abre
  -- nada — ou, pior, chave que abre tudo se alguém "consertar" com um fallback.
  constraint chaves_api_escopo_valido check (escopo in ('envio', 'leitura'))
);

-- A busca é sempre por prefixo, e ele precisa ser único: dois estúdios com o
-- mesmo prefixo fariam a conferência achar a linha errada e comparar o hash
-- errado. Colisão em 6 bytes aleatórios é improvável, e o índice transforma
-- "improvável" em "impossível de passar despercebido".
create unique index if not exists idx_chaves_api_prefixo on chaves_api(prefixo);

-- A tela da conta lista só as ativas do estúdio.
create index if not exists idx_chaves_api_tenant
  on chaves_api(tenant_id) where revogada_em is null;
