-- ============================================================================
--  O NOME DO VÍDEO NA TELA — separado do nome do arquivo
-- ============================================================================
--
--  30/09/2026, Juan, depois de ver o Stream: "adicionar possibilidade de
--  trocar o nome do arquivo que aparece na visualização".
--
--  Até aqui o título do episódio saía do nome do arquivo (`tituloDoEpisodio`:
--  sem extensão, sem sublinhado, sem o número de ordenação). "03_FINAL_v2_cor"
--  virava "FINAL v2 cor" na frente do casal. Esta coluna é o nome que o
--  fotógrafo escreve para a tela.
--
--  É SÓ o nome de exibição. O arquivo baixado continua chegando com o
--  `nome_original` — é por ele que o fotógrafo e o cliente acham o filme no
--  computador, e trocar o nome do download sem pedir seria surpresa.
--
--  Nulo é o normal, e é o que todo vídeo existente tem: a tela continua
--  tirando o título do arquivo, como antes. O teto de 120 caracteres é o de
--  um título, e não de uma sinopse — a escrita apara, o banco garante.

alter table medias
  add column if not exists titulo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'medias_titulo_curto') then
    alter table medias
      add constraint medias_titulo_curto check (titulo is null or char_length(titulo) between 1 and 120);
  end if;
end $$;
