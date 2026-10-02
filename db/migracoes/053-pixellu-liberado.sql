-- ============================================================================
--  QUEM PODE USAR O "ENTRAR COM A CONTA DO PIXELLU"
-- ============================================================================
--
--  Felipe, 30/09/2026: "crie a opção Login com a conta do Pixellu, igual foi
--  feito para o pixieset, só eu posso habilitar pelo menu admin".
--
--  O par da migração 051 (pixieset_liberado_em), com a mesma forma: carimbo de
--  quando foi liberado, nulo = não liberado, ligado e desligado só pelo botão
--  da ficha do estúdio no admin, com evento na auditoria.
--
--  Liberar ainda não abre o formulário: o conector que entra no Pixellu não
--  existe (`conectorPronto` em src/config/plataformas-de-origem.ts). Ver
--  docs/importacao.md.

alter table tenants add column if not exists pixellu_liberado_em timestamptz;
