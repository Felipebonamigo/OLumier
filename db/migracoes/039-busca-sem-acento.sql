-- Busca de galerias que ignora acento.
--
-- Com a busca no servidor (23/09/2026), quem digita "julia" precisa achar
-- "Júlia & Gustavo". O `ilike` do Postgres ignora CAIXA, não acento — e nome de
-- casal brasileiro é cheio deles: José, Antônio, Mônica, Luís, Inês.
--
-- Até aqui isso funcionava por acidente: o endereço da galeria é gerado do
-- título sem acento (`normalizarEndereco`), e a busca olha o endereço também.
-- O acidente falha no caso mais comum de todos — o fotógrafo renomeia a galeria
-- e o endereço NÃO muda de propósito, porque o link já foi para o WhatsApp do
-- casal. A partir daí título e endereço divergem, e a rede de segurança some
-- justamente de quem mais mexe no sistema.
--
-- `unaccent` seria o jeito canônico, mas é uma extensão (`postgresql-contrib`)
-- e portanto uma dependência a mais para o VPS ter instalada no dia do deploy.
-- `translate` é SQL puro e cobre o português inteiro.
--
-- IMMUTABLE é o que permite indexar `sem_acento(titulo)` no dia em que a
-- varredura de texto pesar. Hoje não pesa: são as galerias de UM estúdio.
create or replace function sem_acento(t text) returns text as $$
  select translate(
    t,
    'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇñÑ',
    'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcCnN'
  );
$$ language sql immutable strict;
