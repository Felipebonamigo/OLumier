-- ENDEREÇO ANTIGO DA GALERIA: trocar o link do casal sem quebrá-lo.
--
-- Irmã da 025, que fez isto para o endereço do ESTÚDIO. O problema é o mesmo e
-- a solução é a mesma; o que muda é o escopo da unicidade, e é onde mora a
-- decisão desta migração.
--
-- ── DE ONDE VEIO ───────────────────────────────────────────────────────────
--
-- Juan, 05/09/2026: "to tentando trocar o url e não consigo, clico e a área não
-- é clicável"; e, olhando o link que saiu, "o link não gostei porque não
-- consegui arrumar o 2". A galeria dele nasceu `paula-bruno-2` porque ele já
-- tinha criado uma `paula-bruno` por engano — e o 2 ia ficar lá para sempre.
--
-- O campo era travado com razão: `galerias.slug` é a metade final do link que
-- vai para o WhatsApp do casal e é repassado para a família inteira. Trocá-lo
-- transformava em erro um link em circulação. Em 05/09 isso foi meio-resolvido:
-- a troca passou a valer enquanto a galeria não tivesse sido publicada nem
-- aberta. Meio-resolvido é o nome certo — quem errou o endereço e só percebeu
-- depois de entregar continuava preso a ele.
--
-- ── POR QUE A CHAVE É (tenant_id, slug), E NÃO slug SOZINHO ────────────────
--
-- Em `enderecos_antigos` (025) o slug é chave primária porque endereço de
-- estúdio é global: dois estúdios não podem reivindicar o mesmo, senão o link
-- entregue por A passa a abrir a galeria de B.
--
-- Endereço de galeria não é global — ele vive DENTRO do estúdio
-- (/g/<estudio>/<galeria>). Duas fotógrafas podem ter, cada uma, uma galeria
-- `paula-bruno`, e isso não é conflito nenhum: os links completos são
-- diferentes. Fazer o slug global aqui seria inventar uma escassez que o
-- endereço não tem, e a primeira `casamento` do sistema tomaria a palavra de
-- todo mundo.
--
-- ── O QUE A CHAVE ESTRANGEIRA DECIDE ──────────────────────────────────────
--
-- Cascata na galeria: galeria destruída de vez (lixeira vencida) solta os
-- apelidos dela. É a decisão certa, e o preço é que o link antigo daquela
-- galeria deixa de abrir — o que já era verdade, porque a galeria também não
-- abre mais.
--
-- A cascata no tenant vem de graça pela cascata da galeria, mas a coluna
-- `tenant_id` fica mesmo assim: é ela que participa da chave, e derivá-la por
-- junção a cada visita que erra o endereço seria pagar uma junção para
-- responder "de quem é este endereço".

create table if not exists enderecos_antigos_galeria (
  tenant_id  uuid not null references tenants (id) on delete cascade,
  slug       text not null,
  galeria_id uuid not null references galerias (id) on delete cascade,
  criado_em  timestamptz not null default now(),
  primary key (tenant_id, slug)
);

-- "Quais apelidos são desta galeria?" — a pergunta da tela (para mostrar os
-- links antigos que continuam valendo) e a do limite de trocas.
create index if not exists enderecos_antigos_galeria_galeria_idx
  on enderecos_antigos_galeria (galeria_id);
