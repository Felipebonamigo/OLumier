-- ============================================================================
--  019 — a seleção do álbum
--
--  As favoritas (migração 010) já resolviam a marcação. O que faltava era tudo
--  o que vem DEPOIS dela: quantas fotos cabem, até quando dá para escolher, e
--  como o fotógrafo sabe que pode começar a editar.
--
--  Sem "acabou", a lista fica aberta para sempre e o fotógrafo não tem sinal
--  nenhum: ele fica olhando o painel, ou pergunta no WhatsApp — que é
--  exatamente o vai e volta que as favoritas vieram matar.
--
--  ── A MUDANÇA DE MODELO, E O QUE ELA CUSTA ────────────────────────────────
--  A 010 deu uma lista para CADA VISITANTE, de propósito: a noiva no celular e
--  o noivo no notebook eram duas listas, e o painel mostrava quantas pessoas
--  marcaram cada foto — foto marcada pelos dois era escolha óbvia.
--
--  Isso deixa de fechar quando entra limite. "O álbum tem 40 fotos" é uma frase
--  sobre a GALERIA, não sobre cada aparelho; com uma lista por pessoa, o casal
--  escolheria 80 e descobriria depois. E "terminei" também é do casal: fechar só
--  a minha lista não diz ao fotógrafo que ele pode editar.
--
--  Então a seleção passa a ser UMA, da galeria. O que se perde é a contagem de
--  quantas pessoas marcaram a mesma foto, e vale escrever por quê isso é
--  aceitável: aquele número ajudava a ESCOLHER, e a escolha agora tem dono
--  único. A coluna `visitante` fica — ela deixou de separar listas e passou a
--  registrar quem marcou primeiro, que é o que permite desfazer marcação alheia
--  sem transformar a galeria em terra de ninguém.
-- ============================================================================

-- ── 1. uma linha por foto, não por foto+pessoa ──────────────────────────────

-- Antes de trocar o índice, some com o que ele permitia: a mesma foto marcada
-- por duas pessoas são duas linhas hoje, e virariam violação amanhã. Fica a mais
-- antiga — quem marcou primeiro é quem responde pela escolha.
delete from favoritas f
 using favoritas mais_antiga
 where f.galeria_id = mais_antiga.galeria_id
   and f.media_id   = mais_antiga.media_id
   and (mais_antiga.criado_em, mais_antiga.id) < (f.criado_em, f.id);

drop index if exists idx_favoritas_media_visitante;

-- O índice que sustenta o modelo novo. Também é o que segura o clique duplo: o
-- `on conflict` do insert aponta para ele.
create unique index if not exists idx_favoritas_galeria_media
  on favoritas(galeria_id, media_id);

comment on column favoritas.visitante is
  'Quem marcou primeiro. Id anônimo por galeria, em cookie assinado. Não identifica pessoa.';

-- ── 2. as regras da seleção, na galeria ─────────────────────────────────────

alter table galerias
  add column if not exists selecao_limite      int,
  add column if not exists selecao_prazo       timestamptz,
  add column if not exists selecao_fechada_em  timestamptz;

comment on column galerias.selecao_limite is
  'Quantas fotos o cliente pode escolher. NULL = sem limite, que é o padrão.';
comment on column galerias.selecao_prazo is
  'Depois desta data a seleção tranca sozinha. NULL = sem prazo.';
comment on column galerias.selecao_fechada_em is
  'Quando o cliente disse "terminei". NULL = ainda escolhendo.';

-- Limite zero ou negativo travaria a galeria sem dizer por quê — e é digitação
-- errada, não intenção. Quem não quer limite deixa em branco.
alter table galerias
  drop constraint if exists selecao_limite_positivo;
alter table galerias
  add constraint selecao_limite_positivo
  check (selecao_limite is null or selecao_limite > 0);
