-- Derivadas de imagem: miniatura (grade) e preview (lightbox).
-- Geradas no navegador durante o upload; o original continua intocado.
-- Nulas = servir o original (vídeo, HEIC que o navegador não decodifica, uploads antigos).
alter table medias add column if not exists chave_thumb   text;
alter table medias add column if not exists chave_preview text;
