-- ============================================================================
--  A RECUSA DO SERVIDOR TAMBÉM SE RECONHECE PELO TEXTO
-- ============================================================================
--
--  Felipe, 13/10/2026, olhando "Velocidade real": oito linhas iguais da Sara
--  Feitosa Fotografia — "No período de teste o espaço é de 10 GB. Assine para
--  liberar…" — dentro dos "envios que desistiram", que marcavam 1.038 em três
--  estúdios.
--
--  Não eram quedas de rede. Eram recusas do plano (a conta no teste, no teto
--  dos 10 GB), e a migração 069 já tinha aprendido a separá-las: a marca
--  `recusa` vem do navegador, que a decide ao receber o erro. Só que a aba da
--  Sara estava aberta desde ANTES da 069 e seguia mandando as medidas no
--  formato antigo, sem a marca — e cada foto recusada voltava a parecer queda
--  de rede, escondendo as quedas de verdade.
--
--  O servidor passa a reconhecer a recusa também pelo texto, ao gravar (ver
--  `ehRecusaDoServidor` em `lib/velocidade-regras.ts`, que lê a mesma lista).
--  Esta atualização corrige as linhas que chegaram assim depois da 069. Os
--  textos são os da 069: o começo da mensagem que a rota de envio devolve é
--  fixo, e o texto fica guardado com teto de 200 caracteres.
-- ============================================================================

update envios_medidos
   set recusa = true
 where not ok
   and not recusa
   and erro like any (array[
        'No período de teste o espaço é de %',
        'Espaço insuficiente no plano%',
        'Seu teste grátis terminou%',
        'Há uma cobrança em aberto%',
        'Sua assinatura foi cancelada%',
        'Confirme seu e-mail para começar%',
        'Sessão expirada%',
        'Esta galeria está no cofre%',
        'Galeria não encontrada%',
        '%: tipo não aceito.%',
        '% passa de 100 GB, o limite por arquivo.%'
   ]);
