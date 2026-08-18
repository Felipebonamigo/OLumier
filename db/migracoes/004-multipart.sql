-- Envio em partes: guarda o identificador enquanto o arquivo sobe.
-- Fica nulo quando o envio termina (ou quando foi PUT único).
alter table medias add column if not exists upload_id text;
