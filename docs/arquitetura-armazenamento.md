# Arquitetura de armazenamento — desenho revisado

**Status: aprovado pelo Felipe em 25/08/2026, com o ESPELHO CANCELADO depois.**
Substitui o desenho anterior de `obra-rota-b2.md`, que mantinha galeria pequena
no R2 e cobrava cofre à parte.

⚠️ **A coluna "ESPELHO" abaixo descreve um mundo que não existe.** O espelho
frio na Hetzner nunca foi comprado, e o espelho de arquivos no B2 foi removido
em 27/08/2026 — código, temporizadores, variáveis e colunas do banco. O custo
real em vigor é **R$ 0,0459/GB** (original no B2 + derivada no R2, sem espelho
nenhum), calculado em `config/planos.ts`. O desenho fica registrado porque o
raciocínio de custo e de latência continua valendo; a segunda cópia, não.
Ver `scripts/testar-sem-espelho.mjs` e `docs/backup.md`.

Este documento existe porque o desenho de 24/08 foi construído sobre duas
suposições que a medição derrubou no dia seguinte. Ele registra o que ficou de
pé, o que caiu, e por quê — para a próxima sessão não reconstruir o raciocínio
do zero nem repetir os erros.

## O que mudou, e o que derrubou cada coisa

| Suposição de 24/08 | O que a mediçãoensinou |
|---|---|
| "B2 custa R$ 0,033/GB" | Subiu para **R$ 0,0382** em 01/05/2026 (+16%). Em compensação, as transações ficaram grátis. |
| "Servir do B2 é lento demais para o cliente" | Medido da máquina do Felipe: **1,6× mais lento**, não 5-10×. Uma tela de 300 fotos leva 11,8 s contra 9,4 s do R2. |
| "Worker da Cloudflare na frente do B2 é a válvula de escape" | **Proibido por contrato.** Ver "A porta que está fechada". |
| "Galeria e cofre têm custos diferentes" | Com tudo no B2, custam **exatamente o mesmo**. A franquia de download de 3× cobre a entrega nos casos reais. |

As três primeiras vieram de medição direta (25/08, conexão do Felipe, arquivos
de teste de 100 MB e grids de 40 e 300 miniaturas). A quarta veio de refazer a
conta com o preço corrigido.

## O desenho

```
                     PRIMÁRIO (serve)      ESPELHO (2ª empresa)
originais            B2                    Hetzner Storage Box (rclone)
derivadas            R2  sempre            sem espelho (regeneráveis)
banco                VPS                   dump cifrado no B2
```

**Custo alvo na época: R$ 0,0512/GB/mês** (B2 R$ 0,0382 + espelho frio
R$ 0,013), igual em toda faixa. Contra R$ 0,1207 da rota de então.

**Custo real hoje: R$ 0,0459/GB/mês** — o espelho frio saiu da conta junto com
a decisão de não tê-lo.

Três regras sustentam o desenho:

1. **O navegador só toca o R2.** Miniatura, preview, capa, logo e a renderização
   de streaming ficam no R2 para sempre. É o R2 que tem borda perto do Brasil
   (26 ms contra 153 ms), e é dele que sai tudo que é interativo. Sem isso, uma
   tela de 300 fotos passaria de 9,4 s para 11,8 s — pequeno, mas cobrado em
   toda visita, e a favor de nada.
2. **O B2 serve só o download do original.** É o único caminho onde a latência
   não aparece para quem está olhando a tela. Quem clica "baixar" já espera
   esperar.
3. **O R2 é a válvula de escape, não o padrão.** Isto inverte o desenho
   anterior. Cliente cujo download passe de forma constante da franquia do B2
   volta para o R2, que tem egress genuinamente ilimitado. É a coluna
   `medias.armazem`, que a fase 1 da obra já criou — uma linha, não uma
   arquitetura.

### Por que não tudo no R2

Custa 2,36× mais e não tem trava de exclusão. A economia num cliente de 5 TB é
de **R$ 4.170 por ano**, e o que se paga por ela é 1-2 segundos por galeria
aberta.

### Por que não tudo no armazenamento mais barato

O Hetzner Storage Box custa R$ 0,013/GB — um terço do B2 — e **não consegue
entregar arquivo**: 10 conexões simultâneas na conta inteira (um navegador
sozinho abre 6), sem API S3, portanto sem URL assinada, sem link público, sem
domínio próprio, datacenter só na Alemanha/Finlândia e nenhum número de
durabilidade publicado. A própria Hetzner o posiciona como produto de backup, e
avisa que o Storage Box não é copiado automaticamente.

Preço por GB mede **guardar**. Nós vendemos **entregar**. São produtos
diferentes, e é por isso que a arquitetura tem três fornecedores em vez de um: o
R2 entrega, o B2 guarda com trava, o Hetzner hiberna.

### A porta que está fechada

Servir arquivo do B2 através da CDN gratuita da Cloudflare daria egress zero, e
é o desenho que a documentação da Backblaze recomenda. **Não podemos usar.**

Os Service-Specific Terms da Cloudflare (atualizados em 02/06/2026) reservam o
direito de limitar quem usar a CDN dos planos Free/Pro/Business para servir
vídeo ou "percentual desproporcional de imagens" cuja origem não seja da própria
Cloudflare. O blog deles é explícito: arquivo grande hospedado fora da
Cloudflare segue restrito na CDN. Uma galeria de fotos é o caso mais literal
possível da hipótese.

O risco não é fatura — é **corte sem aviso**, no dia em que um cliente estiver
entregando um casamento. Se o egress do B2 passar da franquia, as saídas são
pagar US$ 0,01/GB (R$ 0,055/GB) ou devolver aquele conteúdo ao R2.

## A franquia de download do B2

Não é cota fixa: **3 × a média mensal guardada**, medida em byte-hora, somando a
conta inteira, sem acumular de um mês para o outro. Só o excedente é cobrado.

O ponto de virada, calculado: o R2 só fica mais barato quando um cliente baixa
**mais de 5× o próprio acervo, todo mês**. Um casamento entregue é baixado 1-3
vezes pelo casal. Chegar a 5× de forma sustentada não é padrão de entrega, é
padrão de quem usa a galeria como CDN de site.

O caso que mais aperta é o **primeiro mês de uma galeria grande**: o byte-hora
trabalha contra, porque o arquivo mal chegou (média baixa, franquia pequena) e é
exatamente quando todo mundo baixa. Do segundo mês em diante o mesmo arquivo
vira franquia parada.

Detalhe que ajuda: arquivo arquivado guarda e nunca é baixado — cada TB parado
gera 3 TB/mês de franquia que ninguém consome. O acervo subsidia a entrega.

## O cofre deixou de ser peça de preço

Com tudo no B2, o GB no ar e o GB arquivado custam o mesmo. Cobrar 36% menos
pelo byte parado virou desconto sem lastro.

O cofre continua existindo como **comportamento**: galeria vence, sai do ar, o
arquivo fica, um clique reativa. O que sumiu foi a cobrança separada, não a
promessa — e a promessa é o que a página `/seguranca` vende.

Três coisas melhoraram junto:

- **A venda passou a ter uma pergunta em vez de duas.** A segunda era impossível
  de responder na hora da compra: ninguém sabe quanto vai arquivar em 2027.
- **Arquivar deixou de poder falhar.** `quota_cofre_bytes` nascia zero, então o
  botão recusava o cliente padrão — o recurso que faz ninguém cancelar estava
  atrás de uma segunda compra que ele não sabia que precisava fazer.
- **O preço de ninguém subiu.** A grade nova é a de galeria, intacta, mais o
  degrau de 3 TB que só existia no cofre.

### O que se perde, e como cobrir

A quota separada era o freio que impedia o acervo comer o espaço de trabalho.
Num balde só, um cliente de 1 TB com 700 GB de entregas antigas fica com 300 GB
para trabalhar — e a reação natural não é comprar mais espaço, é **apagar
entrega**. Que é exatamente o que o produto jura que nunca acontece.

Duas exigências de produto compensam isso, e não são cosméticas:

1. O medidor mostra a quebra (`700 GB no ar · 300 GB arquivado`) como
   **informação, não como dois limites**.
2. O aviso de espaço chega em **80%**, não em 100% — com o caminho de subir de
   faixa ao lado. A escada de preço barateia o GB a cada degrau justamente para
   que subir seja mais atraente que apagar.

## Como sair daqui

O gatilho continua sendo **evento, não data**: a primeira assinatura acima de
500 GB. Antes disso não há economia a colher, e complexidade sem cliente que a
pague é só risco.

Perder a corrida contra o upload do cliente não quebra nada — a rota atual serve
qualquer tamanho corretamente. O que degrada é margem, não serviço.

As fases, com rollback, estão em `obra-rota-b2.md`. O que este documento muda
nelas:

- **fase 3** move o original de TODO mundo para o B2, não só de galeria grande e
  cofre. Não há mais corte em 500 GB, porque não há mais duas rotas.
- **fase 6** vira `ROTA_EM_PRODUCAO = "alvo"` com um custo único por GB, sem
  degrau de faixa.

## Requisitos que não podem cair no caminho

Estes vieram de um painel adversarial e de medição; cada um cobre uma falha que
já aconteceu ou que a conta mostra que aconteceria.

- **Download em massa sai em blocos paralelos com retomada.** Medido: um fluxo
  único rende 131 Mbps contra 207 Mbps em blocos. Mas o motivo principal não é
  velocidade — é que uma queda de conexão aos 80% de 300 GB hoje recomeça do
  zero. Com blocos de 8-12 MB, perde-se um bloco.
- **O bucket primário nasce com Object Lock de 30 dias ligado.** A trava não
  desaparece com o Hetzner: ela troca de lado, do espelho para o primário. Sem
  ela, a fatia dos maiores clientes fica sem cópia imutável em lugar nenhum, e a
  promessa mais vendida da `/seguranca` quebra. O Object Lock **só pode ser
  ligado na criação** do bucket — e nasce sem retenção padrão, o que já
  aconteceu antes com o `olumier-espelho` (ver `backup.md`).
- **Alarme de ausência nos jobs noturnos.** O risco real de um time de uma
  pessoa não é o espelho quebrar, é ele **parar em silêncio** por semanas. O
  alerta tem de disparar pela ausência do aviso de sucesso, nunca pelo erro —
  job que morre não manda e-mail. Somado a `rclone check` semanal por amostra e
  horários escalonados, porque o teto de 10 conexões da Hetzner é da conta toda
  e o backup do banco já o disputa.
- **Carência antes de apagar do R2.** Original só sai depois de checksum
  verificado no destino E de uma carência maior que a validade máxima de URL
  assinada — senão um download em andamento quebra no meio. 48 h custam centavos
  (1 TB × R$ 0,0825 × 2/30 = R$ 0,56).
- **Reconciliação antes do corte.** Upload que chega durante a cópia nasce no R2
  depois da varredura e viraria órfão. Ou congela upload da galeria durante a
  cópia, ou passa uma varredura imediatamente antes de apagar.

## Números de referência

Medidos ou conferidos em 25/08/2026. Câmbio R$ 5,50/US$ e R$ 6,30/€.

| | R2 | B2 | Hetzner |
|---|---|---|---|
| Armazenamento/GB/mês | R$ 0,0825 | R$ 0,0382 | R$ 0,013 |
| Egress | ilimitado grátis | 3× do guardado, depois R$ 0,055/GB | ilimitado |
| Operações | R$ 1,98/milhão | grátis | — |
| Object Lock | não | **sim** | não |
| Latência (medida do Brasil) | 26 ms | 153 ms | — |
| Download 100 MB, 1 fluxo | 25-42 MB/s | 16,4 MB/s | — |
| Download, em blocos | 42,7 MB/s | 25,9 MB/s | — |
| Tela de 300 miniaturas | 9,4 s | 11,8 s | — |
| Serve arquivo? | sim | sim | **não** |

Custo do conjunto (primário + espelho, que é o que a promessa de duas empresas
exige): **R$ 0,1207/GB hoje** contra **R$ 0,0512/GB no alvo**.

| Espaço | Hoje/mês | Alvo/mês | Economia/ano |
|---|---|---|---|
| 1 TB | R$ 120,70 | R$ 51,20 | R$ 834 |
| 5 TB | R$ 603,50 | R$ 256,00 | R$ 4.170 |
| 10 TB | R$ 1.207,00 | R$ 512,00 | R$ 8.340 |
