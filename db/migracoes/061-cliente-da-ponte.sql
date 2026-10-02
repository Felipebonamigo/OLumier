-- ============================================================================
--  O CLIENTE QUE VEIO DO CONTRATO
-- ============================================================================
--
--  Juan, 01/10/2026, sobre a integração com o Atomatiza: "ter a possibilidade de
--  conectar uma galeria com um cartão/cliente/contrato do Atomatiza. Essa função
--  já recolherá os dados automaticamente, como o email por exemplo."
--
--  A ponte já criava a galeria da venda (`origem`/`origem_ref`, e
--  `criarGaleriaDeContrato` do lado de lá). O que ela não trazia era QUEM é o
--  cliente — então o fotógrafo acabava de criar a galeria a partir do contrato e
--  tinha de digitar à mão, na aba Entrega, o e-mail que o Atomatiza já tinha.
--
--  ── POR QUE É SUGESTÃO, E NÃO FILA ────────────────────────────────────────
--
--  Estas duas colunas são o que a tela de Entrega PRÉ-ENCHE. Elas não agendam
--  e-mail nenhum: a galeria nasce vazia, e "suas fotos estão prontas" saindo no
--  instante em que o contrato cria a galeria seria o pior e-mail possível. Quem
--  aperta "Pôr na fila" continua sendo o fotógrafo, depois de subir as fotos.
--
--  ── POR QUE NÃO É UMA LINHA EM `pessoas_da_galeria` ───────────────────────
--
--  Porque ninguém se identificou. `pessoas_da_galeria` é quem ABRIU a entrega e
--  disse quem era; uma linha ali, criada por um contrato, apareceria na aba
--  Atividade como visitante que nunca existiu, e contaria no "quem abriu" que o
--  fotógrafo usa como prova de entrega.
--
--  ── O QUE ACONTECE COM GALERIA QUE NÃO VEIO DA PONTE ──────────────────────
--
--  Nada: as duas colunas nascem nulas e a tela continua com o campo vazio, como
--  hoje. É o estado de todas as 512 galerias que já existem.

alter table galerias
  -- O nome e o e-mail do cliente, como o Atomatiza os tem no contrato. Texto
  -- livre dele: o Olumier não valida identidade de ninguém aqui, só guarda a
  -- sugestão que a tela vai oferecer.
  add column if not exists cliente_nome text,
  add column if not exists cliente_email text;
