-- APELIDO DO CAPÍTULO: o link que dá para mandar por WhatsApp.
--
-- ── DE ONDE VEIO ───────────────────────────────────────────────────────────
--
-- Felipe, 16/09/2026, com a foto da barra de endereço:
--
--   .../g/sirius-fotografia/lumarinowedding?previa=1&cap=c6bcbed2-5d1f-49ca-…
--
-- "O link do capítulo está muito extenso, temos que diminuir e ficar mais
-- simples, para quando mandar."
--
-- O `cap` é o id da seção — 36 caracteres de UUID para dizer "Cerimônia". Ele
-- nasceu assim porque só existia para a própria página se lembrar de qual
-- capítulo estava aberto; virar coisa que se COPIA e MANDA é uso novo, e um
-- UUID no meio de uma mensagem de WhatsApp parece link de rastreamento.
--
-- ── POR QUE UMA COLUNA, E NÃO DERIVAR DO NOME NA HORA ──────────────────────
--
-- Derivar (`gerarSlug(nome)`) seria de graça e erraria em dois casos que
-- existem de verdade:
--
--   · Dois capítulos com nomes que geram o mesmo apelido — "Making Of" e
--     "Making of." — deixariam o link ambíguo, e a página abriria o primeiro
--     que encontrasse. Com coluna, o segundo ganha sufixo na criação e o link
--     continua apontando para um capítulo só.
--   · RENOMEAR o capítulo mudaria o link em silêncio. O fotógrafo troca
--     "Festa" por "Festa 🎉" e o link que ele mandou ontem para o casal morre
--     sem ninguém saber. Com coluna, o apelido é do capítulo, não do texto
--     que por acaso está nele hoje.
--
-- ── A UNICIDADE É POR GALERIA ──────────────────────────────────────────────
--
-- Mesmo raciocínio da 030: o apelido vive dentro de `/g/<estudio>/<galeria>`,
-- então duas galerias podem ter, cada uma, uma `cerimonia`. Torná-lo global
-- inventaria uma escassez que o endereço não tem.
--
-- ── O QUE ACONTECE COM OS LINKS DE ONTEM ───────────────────────────────────
--
-- Nada: a página tenta o apelido primeiro e o UUID depois. Link já mandado com
-- `cap=<uuid>` continua abrindo o mesmo capítulo. Não há o que migrar do lado
-- de quem recebeu.

alter table secoes add column if not exists slug text;

-- Backfill: o apelido sai do nome, e o desempate é a ordem em que o capítulo
-- aparece na galeria — determinístico, então rodar de novo não muda nada.
--
-- `unaccent` não está instalado e não vale uma extensão só para isto: o
-- `translate` cobre o que aparece em nome de capítulo de casamento em
-- português. O que escapar vira `-`, e o `regexp_replace` seguinte junta os
-- traços repetidos.
update secoes s
   set slug = base.apelido
  from (
    select id,
           nullif(
             trim(both '-' from regexp_replace(
               lower(translate(nome,
                 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
                 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
               '[^a-z0-9]+', '-', 'g')),
             '')
           || case when linha > 1 then '-' || linha::text else '' end as apelido
      from (
        select id, nome,
               row_number() over (
                 partition by galeria_id,
                   trim(both '-' from regexp_replace(
                     lower(translate(nome,
                       'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
                       'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
                     '[^a-z0-9]+', '-', 'g'))
                 order by ordem, criado_em
               ) as linha
          from secoes
      ) numeradas
  ) base
 where s.id = base.id and s.slug is null;

-- Capítulo com nome que não sobrou letra nenhuma (só emoji, por exemplo) cai
-- num apelido derivado do id: curto, estável e melhor que um link quebrado.
update secoes set slug = 'cap-' || left(id::text, 8) where slug is null or slug = '';

create unique index if not exists secoes_slug_por_galeria
  on secoes (galeria_id, slug);
