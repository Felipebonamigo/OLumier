# Obra: rota B2 — arquivo pesado sai do R2

**Status: ENTREGUE. O original nasce no B2 desde 25/08/2026 (fase 3); o espelho
frio (fase 4) foi CANCELADO pelo Felipe — custo alto demais para o ganho, e a
decisão é confiar nos onze noves do B2 por enquanto. A régua de custo do código
foi corrigida em 26/08/2026; ver "Depois da obra", no fim.**

## Por que existiu

A grade de preços de 24/08/2026 foi calculada sobre uma rota de custo que nunca foi
construída. TODO arquivo (galeria de qualquer tamanho, cofre, tudo) morava no
Cloudflare R2 a R$ 0,0825/GB/mês, mais o espelho no B2 a R$ 0,0382 — R$ 0,1207/GB
no total. A grade assumia R$ 0,0513/GB para galeria grande e cofre.

Consequência, protegida no código desde 25/08 (`ROTA_EM_PRODUCAO = "atual"` em
`planos.ts`): **114 das 147 montagens vendiam abaixo do custo e retinham 100% do
dinheiro no split** — nenhum sócio recebia nada na maior parte da grade. Esta obra
foi o que destravou o lucro.

| | Custo/GB antes | Custo/GB hoje |
|---|---|---|
| Galeria ≤ 500 GB | R$ 0,1207 | **R$ 0,0459** |
| Galeria > 500 GB | R$ 0,1207 | **R$ 0,0459** |
| Cofre | R$ 0,1207 | **R$ 0,0459** |

> R$ 0,0459 = B2 a R$ 0,0382 mais a derivada que fica no R2 (9,3% dos bytes do
> original, no pior perfil medido). Não há mais degrau por tamanho: o custo é o
> mesmo em toda faixa, porque o arquivo pesado inteiro vai para o B2.

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
o único caminho onde 153 ms de ida e volta não aparecem para o usuário. É isso que
mantém o player 4K rápido (o argumento de venda contra o Pixieset) mesmo com o
arquivo pesado morando longe.

#### Por que a derivada não vai junto — a conta que fecha a discussão

A pergunta volta toda vez ("se é tudo B2, por que não as miniaturas também?"), então
os dois números que a respondem ficam registrados aqui.

**O que se ganha movendo:** quase nada. Derivada (miniatura 640 px + preview 2048 px,
WebP q82 ≈ 280 KB) é **2,7% dos bytes** de uma foto de casamento de 10 MB — e ~0% de
um vídeo. Num acervo de 10 TB são 273 GB de derivada: R$ 22,56/mês no R2 contra
R$ 10,45 no B2. **Economia de R$ 12,11/mês — 1,7% dos R$ 695 que a obra economiza
nesse mesmo cliente.** No pior perfil (fotos leves de 3 MB, derivada vira 9% dos
bytes) ainda são só 5,8%.

**O que se perde movendo:** a galeria. Medido em 25/08/2026, grid de 16 miniaturas
com 6 conexões, três rodadas cada:

| Origem | Cache frio | Quente |
|---|---|---|
| R2, nosso peso (45 KB) | 1,71 s | **1,14 s** |
| B2, nosso peso (45 KB) | 2,54 s | **2,32 s** |
| R2, peso do concorrente (208 KB) | 1,96 s | 1,21 s |
| B2, peso do concorrente (208 KB) | 3,28 s | 3,22 s |
| **Pixellu/SmartGalleries** (208 KB, CloudFront GRU1) | 4,93 s | **0,98 s** |

Repare na linha "R2, peso do concorrente": servindo 4,6× mais bytes o R2 ainda faz em
1,21 s. **Não é o peso que atrasa no B2, é a distância.**

A conclusão é aritmética: manter derivada no R2 custa **1,7% da economia** e é a
diferença entre empatar com o concorrente (1,14 s contra 0,98 s deles) e perder por
2,4× (2,32 s). Os R$ 695 vêm todos dos originais, que são 97% dos bytes. Derivada é
troco — e é 100% da experiência.

> Referência de mercado, medida na galeria real da Carol no SmartGalleries: eles
> servem por CloudFront com PoP em São Paulo, miniatura JPEG de 208 KB (a nossa é
> WebP de ~45 KB, 4× mais leve) e a galeria entrega no máximo 2048 px — o caminho
> `/gal/aws/2k/`. O download do original em resolução cheia, que é nosso
> diferencial, não existe lá.

**Download em massa sai em partes, não em fluxo único.** Numa rede longa
(Brasil → EUA, 153 ms medidos) a latência é o teto da velocidade por conexão — a
janela TCP dividida pelo tempo de ida e volta. Medido de verdade, baixando 100 MB
da máquina do Felipe: **16,4 MB/s (131 Mbps) num fluxo único**, subindo para
**25,9 MB/s (207 Mbps) com blocos paralelos**. O R2, no mesmo teste, faz 42,7 MB/s.
Um casamento de 300 GB leva ~2,0 h pelo R2, ~5,2 h pelo B2 em fluxo único e ~3,3 h
pelo B2 em blocos.

O motivo de exigir blocos, porém, **não é a velocidade** — 58% de ganho é bom, não
dramático. É a **retomada**: 300 GB num fluxo único que cai aos 80% recomeça do zero;
em blocos de 8-12 MB, perde-se um bloco. O paralelismo tem retorno decrescente
(medido: 12 conexões 24,6 MB/s, 24 conexões 25,9 MB/s), então o ponto bom é 8-12
blocos, não mais.

> Duas versões anteriores deste documento erraram aqui, nas duas direções: primeiro
> dizendo "latência irrelevante para download em massa" (falso para fluxo único), e
> depois "30-100 Mbps, 7 a 22 horas" (pessimismo por estimativa). Os números acima
> são medidos, não calculados — se alguém for revisar, meça de novo em vez de
> estimar.

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
2. **Leitura por armazém.** Um módulo despachante (`lib/armazem.ts`) decide de qual
   fornecedor cada arquivo sai; os chamadores passam `m.armazem`. Comportamento
   idêntico (tudo ainda 'r2'). *Pronto:* suíte inteira verde.
   *Rollback:* revert do commit.
   **Entregue em 25/08/2026.** Duas coisas mudaram em relação ao previsto aqui:
   - Não virou parâmetro do `urlDeLeitura`. Isso faria `r2.ts` importar `b2.ts`, que
     já importa `dispositionSegura` do `r2.ts` — ciclo entre os dois módulos de
     armazenamento. O despachante é um terceiro módulo e nenhum lado conhece o outro.
   - A regra perigosa não era o original, era a **derivada ausente**. Miniatura é
     opcional (vídeo sem capa, HEIC antes da conversão, foto recém-enviada), e onde
     ela falta o código cai no original. Se o fallback continuasse pedindo ao R2 um
     arquivo já movido para o B2, o grid abriria com buracos só nos itens sem
     derivada — passa em teste com galeria de exemplo e quebra na do cliente. Por
     isso `urlDaDerivada` recebe as duas chaves e o armazém juntos: quem escolhe a
     chave escolhe o armazém na mesma expressão.
   - Efeito colateral na vitrine do estúdio: a query usava
     `coalesce(cm.chave_thumb, cm.chave, pm.chave_thumb, pm.chave)`, que achata as
     quatro possibilidades numa chave só e esconde qual venceu. Passou a trazer
     miniatura, original e armazém em colunas separadas, escolhendo a MÍDIA inteira
     (`case when cm.chave is not null`) — um `coalesce` por coluna pegaria a
     miniatura de uma foto com o original de outra.
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

---

## Depois da obra — a régua de custo (26/08/2026)

A obra terminou e o espelho frio foi cancelado. Aí as duas rotas de
`planos.ts` viraram descrições de mundos que não existem:

- `atual` cobrava por um espelho que não há e por um primário que mudou de casa
  (R$ 0,1207/GB);
- `alvo` cobrava por uma caixa da Hetzner que não foi comprada (R$ 0,0512/GB).

`ROTA_EM_PRODUCAO` ficou em `"atual"`, e o efeito foi caro em silêncio: o código
contava R$ 0,1207/GB contra R$ 0,0459 reais, e **nenhuma faixa de 1 TB para cima
repassou um centavo aos sócios** — retendo 100% para se proteger de um prejuízo
que já não existia. Nada na tela dizia por quê.

Reter 100% foi a proteção CERTA enquanto a obra não saía: distribuir lucro
calculado numa rota barata que ainda não existia seria pagar sócio com dinheiro
da fatura. O que não pode é a proteção continuar ligada depois que o motivo
acabou.

**O que mudou:** o tipo `Rota` e `ROTA_EM_PRODUCAO` foram removidos. Há um custo
só, e ele descreve a arquitetura que está no ar — original no B2, derivada no
R2, sem espelho. Se um dia entrar espelho frio, é somar uma constante a
`custoEspacoCentavos`, não ressuscitar o seletor.

A proteção não se perdeu junto: ela nunca morou na rota. Quem trava o lucro em
zero quando o custo engole o preço é `lucroCentavos`, em `socios.ts`, e continua
igual.

**O alarme que faltava.** `testar-planos.mjs` agora exige que TODA faixa libere
lucro para o split. No dia em que uma travar, o teste fica vermelho e obriga a
decisão a ser tomada por gente — em vez de o dinheiro parar sozinho.

### Um teste que não podia falhar

No mesmo dia apareceu o motivo de ninguém ter notado antes.
`testar-cobranca.mjs` chamava `custoTetoCentavos` com a forma antiga da montagem
(`galeriaGb`/`cofreGb`, de quando o cofre era peça). A função lê `espacoGb`,
então o custo virava `NaN` — e `reserva < NaN` é sempre falso. A etapa que existe
justamente para provar que a reserva cobre o custo **nunca teve como ficar
vermelha**.

Corrigido dos dois lados: a chamada usa `espacoGb`, e `custoEspacoCentavos`
recusa montagem sem `espacoGb` em vez de devolver `NaN`. Falhar alto é o que
transforma esse tipo de erro em teste vermelho no mesmo dia, em vez de meses de
verde sem sentido.
