# Obra: rota B2 — arquivo pesado sai do R2

**Status: aprovado pelo Felipe em 25/08/2026. Fase 1 entregue; fases 2–6 pendentes.**

## Por que existe

A grade de preços de 24/08/2026 foi calculada sobre uma rota de custo que nunca foi
construída. Hoje TODO arquivo (galeria de qualquer tamanho, cofre, tudo) mora no
Cloudflare R2 a R$ 0,0825/GB/mês, mais o espelho no B2 a R$ 0,0382 — R$ 0,1207/GB
no total. A grade assume R$ 0,0513/GB para galeria grande e cofre.

Consequência, já protegida no código desde 25/08 (`ROTA_EM_PRODUCAO = "atual"` em
`planos.ts`): **114 das 147 montagens vendem abaixo do custo atual e retêm 100% do
dinheiro no split** — nenhum sócio recebe nada na maior parte da grade. Esta obra é
o que destrava o lucro.

| | Custo/GB hoje | Custo/GB pós-obra |
|---|---|---|
| Galeria ≤ 500 GB | R$ 0,1207 | R$ 0,1207 (não muda) |
| Galeria > 500 GB | R$ 0,1207 | **R$ 0,0513** |
| Cofre | R$ 0,1207 | **R$ 0,0513** |

> Preços conferidos nas páginas oficiais em 25/08/2026: R2 US$ 0,015/GB; B2
> US$ 6,95/TB (era US$ 6,00 até 01/05/2026 — 16% de aumento, e o motivo de a grade
> do cofre ter sido revista duas vezes no mesmo dia). Na mesma data as transações
> do B2 (Class A/B/C) ficaram grátis, então não há custo por requisição a somar.

## Quando a obra começa

O gatilho é **evento, não data**: a primeira assinatura de galeria > 500 GB **ou de
cofre > 500 GB**. Nunca antes — complexidade sem cliente que a pague é só risco.

O cofre entra no gatilho por um motivo que quase passou batido: a grade do cofre
está precificada no custo ALVO, mas o cofre hoje vive na infra cara, e cofre tende a
100% de ocupação desde o primeiro dia (é arquivo, não espaço de trabalho). Um cofre
de 2 TB vendido antes da obra custa R$ 241/mês contra R$ 169 de receita — dinheiro
real todo mês, e a retenção de 100% no split protege o repasse aos sócios, não o
caixa. Assinou cofre grande, a fatia-cofre da obra começa (é a menor de todas:
conteúdo offline, sem rota de entrega, sem derivadas — é mover objeto).

Perder a corrida contra o upload do cliente **não quebra nada**: a rota atual serve
qualquer tamanho corretamente. O que degrada é margem, não serviço — e a sangria
máxima plausível durante a janela da obra é de poucas centenas de reais, coberta
pela própria mensalidade do cliente que a disparou.

## O desenho

Regra inegociável (página /seguranca): **todo original em duas empresas diferentes**.

```
                        PRIMÁRIO (serve)          ESPELHO (2ª empresa)
galeria ≤ 500 GB        R2  (como hoje)           B2 com Object Lock (como hoje)
galeria > 500 GB        B2  ← move                Hetzner Storage Box ← novo
cofre (arquivada)       B2  ← move                Hetzner Storage Box ← novo
derivadas (thumb/prev)  R2  sempre                sem espelho (regeneráveis)
banco                   VPS                       dump cifrado no B2 (como hoje)
```

- **Upload não muda.** Tudo continua nascendo no R2 pelo fluxo atual (presigned +
  multipart). Um job noturno move depois. Mexer no caminho de upload é o maior
  risco da obra inteira, e é exatamente o que este desenho evita.
- **O que move:** originais de (a) galerias com `estado = 'arquivada'` e (b) tenants
  cuja galeria contratada passa de 500 GB. Derivadas ficam no R2 para sempre — são
  pequenas, o grid da galeria continua rápido, e a conta nem sente.
- **Uma vez no B2, fica no B2.** Galeria reativada do cofre volta ao ar servindo do
  B2 mesmo; não há caminho de volta ao R2 (B2 é mais barato — voltar só queimaria
  transferência).
- **Mesma chave nos dois lados.** O objeto movido mantém a chave; quem decide de
  onde ler é a coluna `medias.armazem`.

### Como o B2 serve galeria (a decisão de arquitetura)

URL assinada S3 direto no endpoint do B2 (`s3.us-east-005.backblazeb2.com`), igual
ao que o R2 faz hoje. Suporta Range.

**O navegador nunca toca o B2.** Miniatura, preview, capa, logo e a renderização de
streaming do vídeo ficam no R2 para sempre — é o R2 que tem borda perto do Brasil, e
é dele que sai tudo que é interativo. O B2 serve **só o download do original**, que é
o único caminho onde 180 ms de ida e volta não aparecem para o usuário. É isso que
mantém o player 4K rápido (o argumento de venda contra o Pixieset) mesmo com o
arquivo pesado morando longe.

**Download em massa sai em partes, não em fluxo único.** Isto é requisito, não
detalhe: numa rede longa (Brasil → EUA, ~180 ms) a latência é o teto da velocidade
por conexão — a janela TCP dividida pelo tempo de ida e volta. Um fluxo só rende
30-100 Mbps, e um casamento de 300 GB levaria 7 a 22 horas. Pior: uma queda de
conexão aos 80% recomeçaria do zero. Blocos de 2-4 GB com Range e retomada, 4 a 8 em
paralelo, recuperam 200-400 Mbps agregados e transformam uma queda na perda de um
bloco. (Uma versão anterior deste documento dizia "latência irrelevante para download
em massa" — é falso para fluxo único, e construir em cima disso daria uma entrega
visivelmente pior que a de hoje.)

Egress do B2: **grátis até 3× o armazenado médio do mês** (nível da conta, todos os
clientes somados); acima disso US$ 0,01/GB. Com ~3 TB guardados a franquia é ~9 TB/mês,
e um casamento de 300 GB baixado inteiro 5 vezes dá 1,5 TB. Estourar não estrangula
nem bloqueia: custa R$ 0,055/GB, absorvido pela folga cambial da reserva.

Alternativas descartadas:
- *Cloudflare Worker na frente do B2* (egress zero): **proibido por contrato**. Os
  Service-Specific Terms da Cloudflare (atualizados em 02/06/2026) reservam o direito
  de limitar quem usar a CDN dos planos Free/Pro/Business para servir vídeo ou
  "percentual desproporcional de imagens" cuja origem não seja da própria Cloudflare;
  o blog deles é explícito: arquivo grande hospedado fora da Cloudflare segue restrito
  na CDN. Uma galeria de fotos é o caso mais literal da hipótese. Não é economia com
  risco de fatura — é risco de corte sem aviso. **Se o egress passar de 3×**, a saída
  é pagar os US$ 0,01/GB ou devolver aquele conteúdo ao R2, que tem egress
  genuinamente ilimitado e é conteúdo hospedado na Cloudflare (isento da restrição).
- *Upload direto no B2 para plano grande*: bifurca o caminho mais crítico do sistema
  e quebra quando o cliente troca de plano. Descartado.

### O espelho frio (Hetzner)

Conteúdo com primário no B2 não pode ter espelho no B2 — mesma empresa, mesma conta,
a promessa "duas empresas" morreria justamente no cofre. O espelho desse conteúdo
vai para um **Hetzner Storage Box** (BX11 1 TB para começar, sobe de degrau conforme
enche; BX21 5 TB €10,90, BX31 10 TB €20,80 — ~R$ 0,013/GB cheio), via **rclone**,
que o servidor já usa para o backup do banco.

Honestidade sobre o que se perde: Storage Box **não tem Object Lock**. Mas a trava
não desaparece do conteúdo — ela **troca de lado**:

| | Primário | Cópia imutável 30 dias |
|---|---|---|
| Hoje (galeria pequena) | R2 (sem trava) | espelho B2 **com Object Lock** |
| Pós-obra (galeria grande, cofre) | B2 **com Object Lock** | espelho Hetzner (snapshots) |

**O bucket primário `olumier-arquivos` nasce com Object Lock governance de 30 dias
LIGADO** — isto é requisito da fase 1, não opcional. Sem ele a fatia dos maiores
clientes ficaria sem cópia imutável em lugar nenhum, e aí sim a promessa mais vendida
da página /seguranca quebraria. Custo de ligar: objeto apagado segue cobrado por até
30 dias, coerente com o prazo da lixeira.

Proteção somada nessa fatia: trava de 30 dias no primário + snapshots automáticos da
caixa + credencial própria só-do-espelho, restrita e sem `bypassGovernance`
(`scripts/chave-b2.mjs`). A página /seguranca troca "espelho com Object Lock" por
"cópia imutável de 30 dias" na fase 6 — continua verdadeiro nas duas rotas. Só entra
na página o que estiver ligado.

### Ordem de segurança do movimento

Um original só é apagado do R2 depois de existir **verificado** (sha256) no primário
novo (B2) E no espelho frio (Hetzner). Até lá convivem três cópias. O espelho antigo
no B2 (`espelho/<chave>`) tem Object Lock de 30 dias — não pode ser apagado antes do
prazo; a purga de órfãos já existente limpa depois que a trava vence.

Duas regras a mais fecham a janela de inconsistência de uma galeria **no ar** durante
a mudança (o resto da tela não corre risco: derivadas nunca saem do R2, então
navegação e player não piscam — só o download de original troca de origem):

1. **Carência maior que a validade da URL assinada.** Uma URL emitida antes do corte
   aponta para o objeto no R2; apagá-lo dentro da validade quebra um download em
   andamento. 48 h de carência custam centavos (1 TB × R$ 0,0825 × 2/30 = R$ 0,56).
2. **Reconciliação antes do corte final.** Upload que chega DURANTE a cópia nasce no
   R2 depois da varredura e viraria órfão não migrado. Ou congela upload da galeria
   durante a cópia, ou passa uma varredura de reconciliação imediatamente antes de
   apagar. Sem isso, o primeiro cliente grande é onde o bug aparece às 23h.

### Detecção — o risco real de time de uma pessoa

A falha mais provável da fase 2 não é quebrar: é o espelho **parar em silêncio** por
semanas (credencial vencida, caixa fora do ar, ou colisão no limite de 10 conexões
simultâneas, que é da CONTA Hetzner inteira e já é disputado pelo rclone do backup).
Espelho morto sem aviso = a promessa "cada arquivo em duas empresas" deixa de ser
verdade sem ninguém saber, e a descoberta acontece no pior dia possível.

Obrigatório junto da fase 4, meio dia de trabalho:
- **Alarme de ausência** (dead-man switch): cada job noturno avisa um healthcheck ao
  terminar bem; o silêncio é que dispara o alerta. Job que morre não manda e-mail —
  por isso a ausência tem de ser o gatilho, nunca o erro.
- **`rclone check` semanal** contra uma amostra, comparando tamanho e hash.
- **Horários escalonados** entre todos os jobs que tocam a conta Hetzner, por causa
  do teto de 10 conexões — dois jobs concorrentes falham de forma intermitente, que é
  o tipo de falha mais caro de diagnosticar.

## Mudanças no código

| Arquivo | Mudança |
|---|---|
| `db/migracoes/015-rota-b2.sql` | `medias.armazem text not null default 'r2' check in ('r2','b2')`; `medias.espelho_frio_em timestamptz`; índices parciais para as filas do mover e do espelho frio |
| `src/lib/b2.ts` (novo) | cliente S3 do bucket primário `olumier-arquivos` (chave própria, restrita, SEM bypassGovernance — reusar `scripts/chave-b2.mjs`) |
| `src/lib/r2.ts` | `urlDeLeitura(chave, expiraSeg, baixarComoNome, armazem = "r2")` — default preserva todos os chamadores de derivadas/logo; pontos que servem ORIGINAL passam `m.armazem` |
| `scripts/mover-para-b2.mjs` (novo) | noturno: copia R2→B2 com verificação, marca `armazem = 'b2'`; NÃO apaga o R2 (isso é da fase 5) |
| `scripts/espelho-frio.mjs` (novo) | rclone do primário B2 para a Hetzner; marca `espelho_frio_em`; conferência de tamanho/hash |
| `scripts/limpar-r2-movidos.mjs` (novo) | apaga do R2 só o que tem primário B2 + espelho frio verificados; recusa qualquer outra coisa |
| `scripts/conferir-copias.mjs` (novo) | invariante global: nenhum original com cópia única; roda no vigia |
| `ops/` | `fotonio-mover.{service,timer}` (04:20) e `fotonio-espelho-frio.{service,timer}` (04:40) — entre o espelho (04:10) e a lixeira (04:50) |
| `src/config/planos.ts` | fase 6: `ROTA_EM_PRODUCAO = "alvo"` — reservas e margens se corrigem sozinhas |
| `src/app/(institucional)/seguranca/page.tsx` | fase 6: texto do espelho frio |

## Fases — cada uma entra sozinha, com rollback

1. **Fundações.** Bucket `olumier-arquivos` **com Object Lock governance de 30 dias
   ligado** + chave restrita; `b2.ts`; migração 015. Tudo com `armazem = 'r2'` —
   produção não muda em nada. *Pronto quando:* testar-b2 verde (upload/leitura/range
   no bucket novo) **e a trava conferida de verdade** — tentar apagar um objeto
   recém-gravado tem de ser recusado. *Rollback:* nada a desfazer.
   **Código entregue em 25/08/2026**; as etapas de rede ficam PULADAS até o bucket
   existir — ver "Ligar o armazém dos arquivos" no fim deste documento.
2. **Leitura por armazém.** `urlDeLeitura` com o parâmetro; chamadores de original
   passam `m.armazem`. Comportamento idêntico (tudo ainda 'r2'). *Pronto:* suíte
   inteira verde. *Rollback:* revert do commit.
3. **Mover noturno.** Galerias arquivadas + tenants grandes migram original a
   original, verificado. R2 intocado. *Pronto:* amostra real movida, galeria de teste
   servindo do B2 (thumb do R2, original do B2), player com seek ok. *Rollback:*
   `update medias set armazem = 'r2'` — os objetos continuam lá.
4. **Espelho frio.** Storage Box + rclone + timer, **mais o alarme de ausência e os
   horários escalonados** (ver "Detecção"). *Pronto:* `rclone check` zero diferenças
   na amostra; `conferir-copias` verde; **e o alarme testado ao contrário** —
   desligar o job de propósito tem de gerar aviso. *Rollback:* desligar timer.
5. **Limpeza do R2.** Apagar movidos verificados, respeitando a carência de 48 h e a
   reconciliação (ver "Ordem de segurança"); a fatura do R2 cai de verdade.
   Ponto sem volta por objeto — por isso é a ÚLTIMA fase mecânica, com dupla
   checagem e limite por rodada. *Rollback:* não há (mas há duas cópias vivas).
6. **Virada.** `ROTA_EM_PRODUCAO = "alvo"`, página /seguranca atualizada, split
   passa a distribuir pela reserva alvo. *Pronto:* testar-planos verde com zero
   montagens "sob obra" na configuração real.

## O que NÃO muda

Upload, preços (grade de 25/08 fica), quota, galerias ≤ 500 GB ativas, espelho B2
das pequenas, backup do banco, lixeira, ids de plano de quem já assinou.

## Riscos assumidos

- **Egress 3× do B2**: monitorar. A válvula NÃO é Worker da Cloudflare (proibido por
  contrato — ver "Alternativas descartadas"); é pagar US$ 0,01/GB do excedente
  (R$ 0,055/GB, absorvido pela folga) ou devolver o conteúdo ao R2.
- **Câmbio EUR** (Hetzner): coberto pela folga 1,5 do cofre. Exposição pequena — a
  fatia Hetzner é 1,3 de 5,13 centavos/GB, ou seja 25% do custo pós-obra.
- **Hetzner sem Object Lock**: a trava não some, muda de lado — passa a ficar no
  primário B2 (ligado na fase 1). Somado a snapshots da caixa e credencial própria.
  A página de segurança dirá exatamente isso, sem prometer trava onde não há.
- **Custo fixo da caixa**: paga-se a caixa inteira mesmo vazia. BX11 (1 TB, € 3,20)
  sai a 2,02 centavos/GB contra os 1,31 da BX31 cheia — o custo por GB só chega ao
  número da grade com a caixa cheia. Como o gatilho garante cliente antes de caixa,
  o excedente cai na folga. Ponto de virada B2→Hetzner: ~2 TB espelhados.
- **Download transcontinental**: mitigado por blocos paralelos com retomada (ver "Como
  o B2 serve galeria"). Sem isso, entrega pior que a de hoje — não é opcional.

## Ligar o armazém dos arquivos (fase 1)

Bucket e chave **próprios** — não reaproveitar a chave do espelho. Se a mesma
credencial servisse os dois, um vazamento levaria primário e cópia de segurança
juntos, que é exatamente o acoplamento que esta arquitetura remove.

1. Backblaze → **Buckets** → *Create a Bucket*: nome `olumier-arquivos`, privado,
   com **Object Lock LIGADO**.

   ⚠️ O Object Lock **só pode ser ligado no momento da criação** — bucket criado
   sem ele precisa ser refeito. E ligar não basta: o bucket nasce com a trava
   habilitada e **sem retenção padrão**, ou seja, a trava existe e não é aplicada
   a nada. Foi exatamente o que aconteceu com o `olumier-espelho` (ver
   `docs/backup.md`). Depois de criar, definir a retenção padrão de
   **30 dias, modo `governance`**, e conferir gravando um objeto e tentando
   apagá-lo: a exclusão tem de ser recusada.

   Esta é a cópia imutável do conteúdo pesado — o espelho dele fica na Hetzner,
   que não tem trava nenhuma. Sem esta, os maiores clientes ficam sem cópia
   imutável em lugar nenhum, e a promessa mais vendida da `/seguranca` quebra.
2. Anotar o **Endpoint** do bucket (`s3.us-east-005.backblazeb2.com` ou a região
   que sair) — a região vem embutida nele.
3. **Application Keys** → *Add a New Application Key*, restrita a esse bucket,
   com leitura e escrita.
4. Pôr no `.env.local` (e depois no `/opt/fotonio-shared/.env.production`):

   ```
   ARQUIVOS_ENDPOINT=https://s3.us-east-005.backblazeb2.com
   ARQUIVOS_ACCESS_KEY_ID=...
   ARQUIVOS_SECRET_ACCESS_KEY=...
   ARQUIVOS_BUCKET=olumier-arquivos
   ARQUIVOS_REGIAO=us-east-005
   ```

   ⚠️ Os nomes NÃO são `B2_*` de propósito: o ambiente já tem `B2_KEY_ID`,
   `B2_APPLICATION_KEY` e `B2_BUCKET` sobrando de um experimento antigo, sem
   ninguém lendo. Reusar o prefixo faria o módulo herdar aquele bucket em
   silêncio, e o sintoma (arquivo gravado no lugar errado) só apareceria depois.

5. Conferir:

   ```bash
   node --env-file=.env.local --experimental-strip-types \
        --import ./scripts/registrar-ts.mjs scripts/testar-b2.mjs
   ```

   As sete etapas de rede saem de "pulado" para verde. É esse o critério de
   pronto da fase 1.

6. Depois de configurada, rodar `scripts/chave-b2.mjs` apontando para o bucket
   novo e conferir se a chave veio com `bypassGovernance` — a Backblaze concede
   por padrão às chaves criadas pela interface, e aqui ela não é necessária.
