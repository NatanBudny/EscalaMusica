# Regras de Escala — EscalaMusica

> Arquivo mantido pelo **Agente Documentador**.  
> Não edite manualmente sem atualizar também `regras.json`.

---

## RF — Regras Fundamentais

> Regras que **nunca** podem ser violadas. Violação = escala inválida.

<!-- RF001, RF002... serão inseridas aqui pelo agente documentador -->

---

## RP — Restrições Pessoais

> Regras atreladas a uma pessoa específica. Podem ser de disponibilidade, relacionamento ou condição.

### Formato de cada restrição:
- **RP[ID] · [NOME]** — descrição da restrição
- `tipo`: disponibilidade | relacionamento | condicional | excecao
- `prioridade`: obrigatoria | preferencial

<!-- Restrições serão inseridas aqui pelo agente documentador -->

---

## PE — Preferências de Escala

> Soft rules: devem ser respeitadas quando possível, mas não invalidam a escala.

<!-- PE001, PE002... serão inseridas aqui pelo agente documentador -->

---

## TI — Time e Papéis

> Definição dos papéis existentes e quem pode exercê-los.

### Papéis (campos da escala)
| Campo | Descrição |
|-------|-----------|
| REGENTE LOUVOR | Lidera o louvor no culto |
| EQUIPE LOUVOR | Cantores/músicos do louvor (pode ser múltiplos) |
| MENSAGEM MUSICAL | Canta uma mensagem especial solo no culto (ver detalhe abaixo) |
| AUDIOVISUAL | Operador de mídia/projeção/sonoplastia |
| SUPORTE | Suporte técnico |
| PREGADOR | Quem prega o sermão |
| ANCIÃO | Ancião responsável pelo culto |

### Mensagem Musical — Detalhamento

**Descrição:** Momento especial no culto onde uma pessoa (ou grupo) canta uma música. Pode ser solo, dupla ou trio. Pode ser feita com instrumentos ao vivo ou playback. Qualquer membro da igreja pode ser escalado — não está restrito à equipe de louvor.

**O campo na escala registra um responsável**, que pode ser:
- **Nome de uma pessoa** — ela decide se canta solo, em dupla ou trio e resolve internamente
- **Nome de um departamento** — o departamento é responsável por indicar e resolver quem vai cantar

**Ocorrências por tipo de culto:**

| Dia | Quantidade | Observação |
|-----|------------|------------|
| Sábado | 2 (normalmente) | Uma na Escola Sabatina (ES) e uma no Culto. Em casos especiais de programação, só a do Culto. |
| Domingo | 1 | — |
| Quarta-feira | 1 | — |

**Campo no sistema:** Um único campo `MENSAGEM MUSICAL` por culto. Quando há dois no sábado, o líder gerencia manualmente (ES e Culto separados na prática).

**Progressão informal de experiência:**
- Pessoas iniciando: começam pela mensagem musical do **domingo**
- Com mais experiência: progridem para o **sábado**
- Não há controle formal desta progressão — é feita intuitivamente pelo líder

### Regente de Louvor — Detalhamento

**Descrição:** Pessoa responsável por liderar o momento de louvor no culto vocal **e espiritualmente**. É o ponto focal da equipe — fala entre as músicas, conduz a atenção da congregação, anuncia e encerra o momento de louvor. **É responsável por tudo que acontecer com a equipe de louvor.**

**Composição padrão do louvor:**
- 1 Regente + 5 EQUIPE LOUVOR = **6 pessoas cantando** por culto
- O regente **sempre canta e rege simultaneamente**, mas nunca aparece nos dois campos — ele é escalado apenas como `REGENTE LOUVOR`
- Quantidade padrão de músicas: **3 músicas** por culto

**O que o regente PODE e FAZ:**
- Escolher as músicas (sujeito a veto do diretor)
- Definir se o culto será BANDA ou PB
- Substituir membros da equipe por motivos justificáveis (comportamento, falta no ensaio, desempenho)
- Convidar novos membros se alguém da equipe faltar
- Marcar e coordenar o ensaio, ajustando horário com a equipe
- Combinar a paleta de cores/roupas da equipe no dia
- Fazer Mensagem Musical no mesmo culto que rege (muito raro, sem ocorrência registrada)

**Responsabilidades da função:**
- Garantir que a equipe ensaie as músicas
- Garantir boa performance da equipe no culto
- **Garantir conduta espiritual da equipe — ser exemplo e conduzir espiritualmente**
- Responder por tudo que acontece com a equipe de louvor

**O que o regente NÃO FAZ:**
- Participar da montagem da escala
- Repreender membros publicamente ou aplicar restrições de participação
- Escalar a si mesmo
- Definir unilateralmente as músicas como obrigatórias (diretor pode vetar)
- Alterar quantidade de músicas sem alinhamento com o diretor

**Quem pode ser regente:**
- Existe uma lista principal de regentes habilitados
- Em casos excepcionais, alguém fora da lista pode assumir

**Hierarquia de autoridade sobre o louvor:**
```
DIRETOR (Natan) → REGENTE → EQUIPE LOUVOR
```
- Diretor: define escala, pode vetar músicas, tem autoridade geral
- Regente: tem autonomia sobre ensaio, performance e condução no dia
- Equipe: executa

### Equipe de Louvor — Detalhamento

**Composição:** 5 pessoas + 1 regente = 6 cantores por culto

**Regras de composição (RF):**
- **Obrigatório:** mínimo 1 homem na equipe
  - Exceção: cultos temáticos (ex: Culto da Mulher) podem ter equipe 100% feminina
- **Preferencial:** idealmente 2 ou mais homens na equipe

**Classificação de performance (nível):**
Cada membro da equipe tem um nível que indica sua desenvoltura para cantar no culto:
| Nível | Descrição |
|-------|-----------|
| `Avançado` | Acerta letra, tempo, não se perde — pode ser escalado em qualquer situação |
| `Intermediário` | Bom desempenho, mas pode precisar de apoio em músicas menos conhecidas |
| `Iniciante` | Ainda em desenvolvimento — deve ser escalado com cuidado, preferencialmente em cultos mais simples |

> 🔮 **Feature futura — classificação de voz:** Cada pessoa terá também a classificação vocal (soprano, contralto, tenor, barítono etc.) para que a escala automática possa balancear os naipes e evitar, por exemplo, 3 sopranos juntas.

**Modelo de escalação (times semi-fixos):**
- Cada regente tem um **grupo preferencial** que tende a cantar com ele — promove sinergia e conforto
- Os grupos têm base fixa mas com variações frequentes (disponibilidade, substituições)
- **Hierarquia de substituição:**
  1. Membro do grupo preferencial do regente (disponível)
  2. Membro com perfil similar disponível
  3. Qualquer membro disponível (último recurso)

### Times fixos de louvor (rotação)
<!-- Quando você informar os grupos preferenciais de cada regente, serão inseridos aqui -->

---

## 🔮 Features Futuras

> Ideias e funcionalidades planejadas ainda não implementadas.

**FF001 — Condução espiritual da equipe**  
Dar insights e orientações aos regentes para que conduzam suas equipes em crescimento espiritual, aproximando-as de Deus para que louvem com mais profundidade e autenticidade. Não é controle, é orientação e sugestão do sistema/diretor.

| Termo | Significado |
|-------|-------------|
| Culto | Serviço religioso (quarta, sábado, domingo) |
| Louvor | Parte musical do culto |
| Mensagem musical | Solo especial no culto. No sábado: normalmente 2 (ES + Culto). No domingo e quarta: 1. Qualquer membro pode fazer. |
| Mensagem musical ES | Mensagem musical da Escola Sabatina (parte da manhã do sábado) |
| Mensagem musical culto | Mensagem musical do culto principal do sábado |
| Sonoplastia | Operação de áudio/som (subconjunto de AUDIOVISUAL) |
| Ensaio | Ensaio da equipe de louvor antes do culto principal |
| Escala | Grade de pessoas escaladas por função e data |
| PB | Playback — culto sem banda ao vivo |
| BANDA | Culto com banda ao vivo |
| Regente | Líder do louvor; conduz a equipe vocal e espiritualmente. Responsável por tudo que acontece com a equipe de louvor. |
