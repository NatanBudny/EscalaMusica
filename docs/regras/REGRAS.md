# Regras de Escala — EscalaMusica

> Arquivo mantido pelo **Agente Documentador**.  
> Não edite manualmente sem atualizar também `regras.json`.

---

## RF — Regras Fundamentais

> Regras que **nunca** podem ser violadas. Violação = escala inválida.

**RF001** — A EQUIPE LOUVOR deve ter no mínimo 1 homem.  
_Exceção:_ cultos temáticos femininos (ex: Culto da Mulher) podem ter equipe 100% feminina.

**RF002** — O AUDIOVISUAL não pode acumular REGENTE LOUVOR ou EQUIPE LOUVOR no mesmo culto.

**RF003** — O AUDIOVISUAL não deve aparecer como PREGADOR. Se isso ocorrer, é sinal de erro na escala externa.

**RF004** — Nomes nas funções de origem externa (ANCIÃO, PREGADOR, AUDIOVISUAL, LOUVORES ES) não devem conflitar com as escalações da equipe de louvor (ex: não escalar alguém para EQUIPE LOUVOR que já está como PREGADOR naquele culto).  
_Exceção RF004-A:_ O ANCIÃO pode acumular outros papéis sem restrição — é o gerente do culto.

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

**PE001** — Idealmente, a EQUIPE LOUVOR deve ter 2 ou mais homens.

**PE002** — Quando o PREGADOR informa um tema, alinhar as músicas do louvor a esse tema.

**PE003** — Quando o PREGADOR solicita uma música específica, incorporá-la ao louvor se viável.

**PE004** — Priorizar a escalação do grupo preferencial de cada regente para promover sinergia.

**PE005** — Não escalar AUDIOVISUAL para MENSAGEM MUSICAL, exceto quando não houver nenhuma outra pessoa disponível.

---

## TI — Time e Papéis

> Definição dos papéis existentes e quem pode exercê-los.

### Papéis (campos da escala)
| Campo | Origem | Descrição |
|-------|--------|-----------|
| REGENTE LOUVOR | Escala própria (louvor) | Lidera o louvor no culto |
| EQUIPE LOUVOR | Escala própria (louvor) | Cantores/músicos do louvor |
| MENSAGEM MUSICAL | Escala própria (louvor) | Mensagem especial no culto |
| AUDIOVISUAL | Escala externa (AV) | Operador de sonoplastia/mídia |
| SUPORTE | Escala própria (louvor) | Suporte de rádio |
| PREGADOR | Escala externa (ancianato) | Quem prega o sermão |
| ANCIÃO | Escala externa (ancianato) | Ancião responsável pelo culto |
| LOUVORES ES | Escala externa (ES) | Músicas da Escola Sabatina |

> ⚠️ **Campos de escala externa** (ANCIÃO, PREGADOR, AUDIOVISUAL, LOUVORES ES): os nomes vêm de outros departamentos. Ao montar a escala própria, garantir que **não haja conflito** com esses nomes já definidos externamente.

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

> 💡 O diretor considera que **falar entre as músicas é a parte mais difícil** do papel. Um bom regente faz com que a congregação preste atenção na letra e cante junto.

**Composição padrão do louvor:**
- 1 Regente + 5 EQUIPE LOUVOR = **6 pessoas cantando** por culto
- O regente **sempre canta e rege simultaneamente**, mas nunca aparece nos dois campos — ele é escalado apenas como `REGENTE LOUVOR`
- Quantidade padrão de músicas: **3 músicas** por culto

**O que o regente PODE e FAZ:**
- Escolher as músicas (sujeito a veto do diretor)
- Definir se o culto será BANDA ou PB
- Substituir membros da equipe por **qualquer razão que julgue necessária** (comportamento, falta no ensaio, desempenho, qualquer motivo)
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

### Diretor — Detalhamento

**Descrição:** Responsável geral pelo ministério de louvor. É quem define e monta a escala, recebe as informações dos departamentos externos e tem a palavra final sobre qualquer decisão.

**Responsabilidades:**
- Montar e publicar a escala dos cultos
- Receber informações das escalas externas (ANCIÃO, PREGADOR, AUDIOVISUAL, LOUVORES ES)
- Sugerir músicas ao regente (quando julgar necessário; quando não sugere, o regente escolhe livremente)
- Vetar músicas se necessário
- Ter autoridade final sobre qualquer aspecto do louvor

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

### Ancião — Detalhamento

**Origem:** Escala externa (ancianato/departamento de anciãos)  
**Descrição:** Gerente do culto. Tem autoridade para alterar qualquer aspecto do culto, mas raramente intervém — na prática, confere se tudo está em ordem.  
- Pode acumular outros papéis sem problema (sua presença não impede que apareça em outras funções)
- Se aparecer como pregador: incomum mas possível

### Pregador — Detalhamento

**Origem:** Escala externa (ancianato)  
**Descrição:** Quem prega o sermão/mensagem/meditação bíblica do culto.  
- Às vezes informa um **tema** — quando isso ocorre, o louvor pode ser alinhado a esse tema
- Às vezes **solicita uma música específica** — quando viável, a equipe a incorpora ao louvor

### Audiovisual — Detalhamento

**Origem:** Escala externa (departamento de AV)  
**Descrição:** Responsável pela sonoplastia completa do culto: som, microfones, PA, slides, playback, áudio. Está ativamente operando o tempo todo durante o culto.

**Restrições (RF):**
- **Não pode** acumular REGENTE LOUVOR, EQUIPE LOUVOR no mesmo culto
- **Não pode** acumular PREGADOR no mesmo culto (nunca ocorreu — sinal de erro na escala)
- **Exceção rara:** pode fazer MENSAGEM MUSICAL apenas se não houver nenhuma outra pessoa disponível

### Suporte — Detalhamento

**Origem:** Escala própria (louvor)  
**Descrição:** Faz a ponte de comunicação por rádio entre banda/louvor e sonoplastia. Confirma mudanças de ordem, extrai informações do culto e repassa ao sonoplasta em tempo real.  
- Braço direito do AUDIOVISUAL durante o culto
- **Disponibilidade:** normalmente funciona apenas aos sábados
- **Quadro reduzido:** apenas 1–2 pessoas exercem esse papel

---

## 🔮 Features Futuras

> Ideias e funcionalidades planejadas ainda não implementadas.

**FF001 — Condução espiritual da equipe**  
Dar insights e orientações aos regentes para que conduzam suas equipes em crescimento espiritual, aproximando-as de Deus para que louvem com mais profundidade e autenticidade. Não é controle, é orientação e sugestão do sistema/diretor.

**FF002 — Classificação vocal por naipe**  
Cada pessoa terá a classificação vocal (soprano, contralto, tenor, barítono etc.) para que a escala automática balanceie os naipes e evite agrupamentos como 3 sopranos juntas.

---

## Glossário

| Termo | Significado |
|-------|-------------|
| Culto | Serviço religioso (quarta, sábado, domingo) |
| Escola Sabatina (ES) | Programa de estudo bíblico realizado na manhã do sábado, antes do culto principal. Tem sua própria mensagem musical e músicas (LOUVORES ES), definidas por departamento externo. |
| Louvor | Parte musical do culto |
| Mensagem musical | Momento especial no culto. O campo registra um responsável (pessoa ou departamento) que decide o formato: solo, dupla ou trio. Qualquer membro pode fazer. |
| Mensagem musical ES | Mensagem musical da Escola Sabatina (manhã do sábado) |
| Mensagem musical culto | Mensagem musical do culto principal do sábado |
| Sonoplastia | Operação de áudio/som (subconjunto de AUDIOVISUAL) |
| Ensaio | Ensaio da equipe de louvor antes do culto |
| Escala | Grade de pessoas escaladas por função e data |
| PB | Playback — culto sem banda ao vivo |
| BANDA | Culto com banda ao vivo |
| Regente | Líder do louvor; conduz a equipe vocal e espiritualmente. Responsável por tudo que acontece com a equipe de louvor. |
| Paleta | Combinação de cores/tons de roupa definida pelo regente para a equipe no dia do culto |
