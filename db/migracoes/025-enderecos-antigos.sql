-- ENDEREÇO ANTIGO: trocar o endereço do estúdio sem quebrar link já entregue.
--
-- `tenants.slug` nasce no cadastro e vai para fora em três lugares: o link da
-- galeria (/g/<estudio>/<galeria>), a vitrine (/e/<estudio>) e o subdomínio
-- próprio do estúdio. Trocá-lo derrubava TODO link já mandado para um casal — e
-- link de casamento não se reenvia: ele está num grupo de WhatsApp que ninguém
-- vai reabrir. Por isso o campo era travado, e a tela dizia o motivo.
--
-- A trava resolvia o risco e não resolvia a necessidade: quem digitou o nome
-- errado no cadastro ficava com ele para sempre.
--
-- Agora o endereço anterior vira APELIDO e continua resolvendo, com
-- redirecionamento permanente para o novo. O casal não percebe nada.
--
-- ── POR QUE TABELA, E NÃO UMA COLUNA `slug_anterior` ────────────────────────
--
-- Uma coluna guarda UM endereço. Duas trocas e o primeiro se perde — justamente
-- o mais antigo, que é o que está nos links mais espalhados. A tabela guarda a
-- cadeia inteira, e cada linha carrega a data, que é o que permite responder
-- "desde quando este endereço não é mais dele".
--
-- ── AS DUAS RESTRIÇÕES, E O QUE CADA UMA IMPEDE ───────────────────────────
--
-- `slug` é CHAVE PRIMÁRIA aqui, e não apenas indexado: dois estúdios não podem
-- reivindicar o mesmo apelido. Sem isso, o link que o estúdio A entregou ao
-- casal dele passaria a abrir a galeria do estúdio B — vazamento de galeria
-- entre contas, com aparência de funcionamento normal e nada na tela para
-- denunciar.
--
-- A chave estrangeira apaga em cascata: conta encerrada libera os apelidos dela.
-- É a decisão certa e vale dizer o preço — um link entregue por um estúdio que
-- saiu deixa de abrir. Mas manter o apelido de uma conta que não existe mais
-- seria guardar reserva de endereço para sempre, em nome de quem foi embora.

create table if not exists enderecos_antigos (
  slug       text primary key,
  tenant_id  uuid not null references tenants (id) on delete cascade,
  criado_em  timestamptz not null default now()
);

-- A busca do dia a dia é "de quem era este endereço?", que a chave primária já
-- resolve. Este índice serve à outra pergunta, a da tela e do limite de trocas:
-- "quais apelidos são deste estúdio?".
create index if not exists enderecos_antigos_tenant_idx
  on enderecos_antigos (tenant_id);
