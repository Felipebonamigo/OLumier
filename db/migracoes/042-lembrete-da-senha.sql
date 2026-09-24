-- ============================================================================
--  A SENHA DA GALERIA PASSA A PODER SER LIDA DE VOLTA
-- ============================================================================
--
--  Juan, 24/09/2026: "ao colocar a senha, ela some e eu não sei mais qual a
--  senha".
--
--  Ele está descrevendo o produto funcionando como projetado, e o projeto é que
--  estava errado. A senha era guardada só como hash SHA-256 — irreversível de
--  propósito —, então nem ele nem nós conseguíamos mostrá-la.
--
--  ── POR QUE HASH É A FERRAMENTA ERRADA AQUI ───────────────────────────────
--
--  Hash existe para o segredo de UMA pessoa, que só ela precisa saber. A senha
--  da galeria é o contrário: o trabalho do fotógrafo é CONTÁ-LA ao casal, junto
--  com o link, no WhatsApp. Ele precisa lê-la de volta um mês depois, quando a
--  mãe da noiva pedir.
--
--  E esquecer não é um problema pequeno: a saída era trocar a senha, e trocar
--  derruba todo mundo que já tinha recebido a antiga — a família inteira que já
--  estava com o link.
--
--  O que a senha da galeria protege são fotos atrás de um link que já é secreto,
--  contra alguém que chutaria uma palavra. Não é credencial de acesso a conta, e
--  tratá-la como tal cobrava um preço que o fotógrafo pagava sozinho.
--
--  ── CIFRADA, E NÃO EM TEXTO PURO ──────────────────────────────────────────
--
--  Guardar a senha legível no banco resolveria o problema do Juan e criaria
--  outro: um dump do banco entregaria as senhas de todas as galerias, e gente
--  repete senha entre lugares.
--
--  Então ela vai CIFRADA com o segredo do servidor (AES-256-GCM, ver
--  `lib/senha-da-galeria.ts`). Quem tem só o banco não lê nada; quem tem o
--  banco e o segredo lê — e quem tem o segredo já tinha o resto de qualquer
--  jeito.
--
--  ── O HASH FICA, E CONTINUA SENDO A AUTORIDADE ────────────────────────────
--
--  `senha_hash` não muda: é ele que confere quem digita a senha na galeria, com
--  comparação de tempo constante. Esta coluna é só o LEMBRETE que a tela do
--  fotógrafo mostra. Os dois são escritos na MESMA instrução, sempre — se
--  divergissem, a tela mostraria uma senha que não abre a galeria, que é pior
--  que não mostrar nada.
--
--  Galeria com senha definida ANTES de hoje fica com esta coluna nula: aquele
--  hash não volta atrás. A tela diz isso com todas as letras em vez de fingir.
-- ============================================================================

alter table galerias
  add column if not exists senha_cifrada text;

comment on column galerias.senha_cifrada is
  'A senha da galeria cifrada com o segredo do servidor, para o fotógrafo poder '
  'relê-la e contar ao casal. NULA nas galerias cuja senha foi definida antes de '
  '24/09/2026 — o hash daquelas não volta atrás. Quem confere quem entra '
  'continua sendo senha_hash.';
