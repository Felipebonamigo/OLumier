# Obra: rota B2 — arquivo pesado sai do R2

**Status: aprovado pelo Felipe em 25/08/2026. Fase 1 entregue; fases 2–6 pendentes.**

## Por que existe

A grade de preços de 24/08/2026 foi calculada sobre uma rota de custo que nunca foi
construída. Hoje TODO arquivo (galeria de qualquer tamanho, cofre, tudo) mora no
Cloudflare R2 a R$ 0,0825/GB/mês, mais o espelho no B2 a R$ 0,033 — R$ 0,1155/GB
no total. A grade assume R$ 0,046/GB para galeria grande e cofre.

Consequência, já protegida no código desde 25/08 (`ROTA_EM_PRODUCAO = "atual"` em
`planos.ts`): **114 das 147 montagens vendem abaixo do custo atual e retêm 100% do
dinheiro no split** — nenhum sócio recebe nada na maior parte da grade. Esta obra é
o que destrava o lucro.

| | Custo/GB hoje | Custo/GB pós-obra |
|---|---|---|
| Galeria ≤ 500 GB | R$ 0,1155 | R$ 0,1155 (não muda) |
| Galeria > 500 GB | R$ 0,1155 | **R$ 0,046** |
| Cofre | R$ 0,1155 | **R$ 0,046** |

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
ao que o R2 faz hoje. Suporta Range (o player 4K continua fazendo seek normal).

Egress do B2: **grátis até 3× o armazenado médio do mês** (nível da conta, todos os
clientes somados); acima disso US$ 0,01/GB. Entrega de galeria fica muito abaixo de
3× na média — e o estouro custa centavos, não quebra nada.

Alternativas descartadas:
- *Cloudflare Worker na frente do B2* (egress zero via Bandwidth Alliance): mais uma
  peça deployada, segredo do B2 no Worker, domínio proxied. Vira a válvula de escape
  SE o monitoramento mostrar egress passando de 3×. Não agora.
- *Upload direto no B2 para plano grande*: bifurca o caminho mais crítico do sistema
  e quebra quando o cliente troca de plano. Descartado.

### O espelho frio (Hetzner)

Conteúdo com primário no B2 não pode ter espelho no B2 — mesma empresa, mesma conta,
a promessa "duas empresas" morreria justamente no cofre. O espelho desse conteúdo
vai para um **Hetzner Storage Box** (BX11 1 TB para começar, sobe de degrau conforme
enche; BX21 5 TB €10,90, BX31 10 TB €20,80 — ~R$ 0,013/GB cheio), via **rclone**,
que o servidor já usa para o backup do banco.

Honestidade sobre o que se perde: Storage Box **não tem Object Lock**. Mitigação:
snapshots automáticos da caixa + credencial própria só-do-espelho + o primário B2
continua existindo. A página /seguranca ajusta o texto na entrega (fase 6): a trava
de 30 dias vale para o espelho das galerias pequenas; para o conteúdo grande a
proteção é duas empresas + snapshots. Só entra na página o que estiver ligado.

### Ordem de segurança do movimento

Um original só é apagado do R2 depois de existir **verificado** (sha256) no primário
novo (B2) E no espelho frio (Hetzner). Até lá convivem três cópias. O espelho antigo
no B2 (`espelho/<chave>`) tem Object Lock de 30 dias — não pode ser apagado antes do
prazo; a purga de órfãos já existente limpa depois que a trava vence.

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

1. **Fundações.** Bucket `olumier-arquivos` + chave restrita; `b2.ts`; migração 015.
   Tudo com `armazem = 'r2'` — produção não muda em nada. *Pronto quando:* testar-b2
   verde (upload/leitura/range no bucket novo). *Rollback:* nada a desfazer.
   **Código entregue em 25/08/2026**; as etapas de rede ficam PULADAS até o bucket
   existir — ver "Ligar o armazém dos arquivos" no fim deste documento.
2. **Leitura por armazém.** `urlDeLeitura` com o parâmetro; chamadores de original
   passam `m.armazem`. Comportamento idêntico (tudo ainda 'r2'). *Pronto:* suíte
   inteira verde. *Rollback:* revert do commit.
3. **Mover noturno.** Galerias arquivadas + tenants grandes migram original a
   original, verificado. R2 intocado. *Pronto:* amostra real movida, galeria de teste
   servindo do B2 (thumb do R2, original do B2), player com seek ok. *Rollback:*
   `update medias set armazem = 'r2'` — os objetos continuam lá.
4. **Espelho frio.** Storage Box + rclone + timer. *Pronto:* `rclone check` zero
   diferenças na amostra; `conferir-copias` verde. *Rollback:* desligar timer.
5. **Limpeza do R2.** Apagar movidos verificados; a fatura do R2 cai de verdade.
   Ponto sem volta por objeto — por isso é a ÚLTIMA fase mecânica, com dupla
   checagem e limite por rodada. *Rollback:* não há (mas há duas cópias vivas).
6. **Virada.** `ROTA_EM_PRODUCAO = "alvo"`, página /seguranca atualizada, split
   passa a distribuir pela reserva alvo. *Pronto:* testar-planos verde com zero
   montagens "sob obra" na configuração real.

## O que NÃO muda

Upload, preços (grade de 25/08 fica), quota, galerias ≤ 500 GB ativas, espelho B2
das pequenas, backup do banco, lixeira, ids de plano de quem já assinou.

## Riscos assumidos

- **Egress 3× do B2**: monitorar; válvula = Worker CF (decisão adiada de propósito).
- **Câmbio EUR** (Hetzner): coberto pela folga 1,5 do cofre.
- **Hetzner sem Object Lock**: mitigado por snapshots + primário independente;
  página de segurança dirá exatamente isso, sem prometer trava onde não há.
- **Custo fixo da caixa**: paga-se a caixa inteira mesmo vazia; BX11 (~€4) até
  passar de 1 TB espelhado. Ponto de virada B2→Hetzner já calculado: ~2 TB.

## Ligar o armazém dos arquivos (fase 1)

Bucket e chave **próprios** — não reaproveitar a chave do espelho. Se a mesma
credencial servisse os dois, um vazamento levaria primário e cópia de segurança
juntos, que é exatamente o acoplamento que esta arquitetura remove.

1. Backblaze → **Buckets** → *Create a Bucket*: nome `olumier-arquivos`, privado.
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
