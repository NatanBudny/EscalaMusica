# Regras a decidir e documentar (levantamento de 05/11/2026)

## Situação após as respostas de 05/11/2026

As decisões estão registradas em `processos/regras/REGRAS.md`, na seção "Decisões de 05/11/2026", e implementadas no montador web.

| Item | Situação |
|---|---|
| 1. Manu C., Manu S., Mirella, Marcela | Feito. Vínculos "precisa de" gravados no cadastro; bloqueio na revalidação, com exceção do diretor. Valem também para a MM. |
| 2. Família Silva | Feito. Regra "vínculo" é bloqueio (editável em Regras). |
| 3. Mirian e Lidiane 1x por mês | Feito. Campo "Máximo de escalas no mês" no cadastro (ambas = 1); aviso, e a sugestão automática respeita. |
| 4. Regente repetindo sábado (PE006/PE007) | **Aberto.** Continua só como peso na sugestão. |
| 5. Juliana Alves num domingo | Decidido: foi exceção. Agora o diretor consegue liberar pelo montador. |
| 6. Níveis das fundamentais | Feito. Bloqueio para RF001, RF014, RF004, equipe+MM, equipe incompleta e vínculo; todos editáveis na tela de Regras. |
| 7. Sequência de cultos | Decidido: preferência (aviso). Falta alinhar a numeração RF013/PE006/PE009 nos JSON. |
| 8. Culto departamental | Feito. Coluna "Louvor por" no acionato, copiada da escala do ancionato. |
| 9. Convidados na MM | Feito. Cadastro obrigatório com telefone próprio ou WhatsApp de pessoa cadastrada, direto no seletor. |
| 10. Listas de departamentos / apelido JOVENS do Fabrício | **Aberto.** |
| 11. Campo incentivo apagado | Corrigido. A tela preserva os campos que não edita. |
| 12. Perfil participação | **Aberto.** |
| 13. Afastamentos vencidos | **Aberto.** |
| 14. Regras do legado `docs/regras` | **Aberto.** |
| 15. Ariadny/Catherine só sábado | Ariadny passou a ter "só sábado" no cadastro (migração). Demais itens **abertos**. |
| 16. BANDA/PB | Decidido (sábado BANDA, domingo e quarta PB). O montador já faz assim; o script de linha de comando ainda põe BANDA no domingo. |
| 17. Exceções | Feito. Confirmação do diretor, registro em `escalas/AAAA/MM/excecoes.json`. |
| 18 a 23 | **Abertos.** |
| 24. Giovana sem dias seguidos | **Aberto** no cadastro; respeitado à mão em novembro. |
| 25. Catherine na equipe do Fabrício | Respeitado à mão em novembro (21/11). |
| 26. Sonoplastia coberta por cantor | Em novembro, 07/11 ficou com Luiz Antonio. O montador já confere conflito entre sonoplastia e louvor. |

Correção feita durante os testes: a conferência de links acusava erro quando a sonoplastia vinha pelo apelido (ex.: "JÚNIOR OLIVEIRA", que é ENOQUE JR.). Agora a conferência também aceita o apelido, desde que ele seja de uma pessoa só.

---

Levantamento feito para a passagem ao novo responsável. Cruzei `processos/regras/` (REGRAS.md e JSONs), `docs/regras/` (legado), `docs/resumo.md`, `pessoas.json`, o auditor dos scripts (`scripts/lib/auditor-escala.js`) e o montador (`montador/lib/`), que é a ferramenta que o sucessor vai usar.

Nada foi alterado. Cada item termina com a decisão que falta.

## Achado principal

O montador e o auditor aplicam regras diferentes.
- O montador não lê o `REGRAS.md` nem o `restricoes-pessoais.json`. Ele só usa os campos de `pessoas.json` (ativo, afastado, habilitações, dias permitidos, vínculos), os níveis de `processos/regras/parametros.json` e listas fixas no código.
- O auditor só roda pela linha de comando (`npm run validar:rascunho`), que o sucessor não vai usar.

Na prática, toda regra que não está em campo do cadastro nem em `parametros.json` deixa de ser checada quando o sucessor monta a escala.

## A. Regras que o montador não checa (risco alto)

1. **Manu C. só canta com Silvana; Manu S. só com Jessica ou Joás; Mirella e Marcela só com Nilson.** Só o auditor checa, como erro (`auditor-escala.js:136-139`). Existe uma migração no montador que grava isso no cadastro (`montador/lib/migracoes.mjs`, `migrarRegrasPorNome`), mas ela nunca foi aplicada: `pessoas.json` não tem a chave `migracoes`. Se aplicada, a regra vira só **aviso** e passa a valer também para a Mensagem Musical.
   - Decidir: aplicar a migração? É bloqueio ou aviso? Vale para a MM? Mirella e Marcela podem fazer MM sem o Nilson? Em 18/10 fizeram.
2. **Família Silva (Bete e Luiz da Silva precisam de alguém da família).** Montador: aviso. Solver: exclui a pessoa. Auditor: não checa.
   - Decidir: bloqueio ou aviso?
3. **Mirian no máximo 1 vez por mês (RP015) e Lidiane 1 vez por mês (RP007, que só existe no JSON).** Nenhuma ferramenta checa.
   - Decidir: oficializar? Como aviso?
4. **Regente não repete sábado (PE006 e PE007).** PE006 não está implementado. PE007 existe só como peso no solver e conta também domingo.
   - Decidir: deve virar aviso?
5. **Juliana Alves só sábado.** O montador bloqueia sem permitir exceção. Mas em 18/10 (domingo) ela foi escalada.
   - Decidir: a regra mudou ou foi exceção?

## B. A mesma regra com nível diferente em cada ferramenta

6. Abaixo, o nível de cada regra no montador e no auditor. O REGRAS.md trata todas como obrigatórias.

| Regra | Montador | Auditor |
|---|---|---|
| Mínimo 1 homem (RF001) | aviso | erro |
| 1 MM por mês (RF014) | aviso | erro |
| Pregador no louvor (RF004) | aviso | erro |
| Casais sempre juntos | aviso | erro |
| Equipe e MM no mesmo culto | aviso | erro |
| Equipe diferente de 5 | aviso | erro |

   - Decidir: o nível de cada uma. O sucessor só vê avisos, e avisos não impedem publicar.
7. **Sequência de cultos (RF013).**
   - O REGRAS.md diz que é obrigatória.
   - O `fundamentais.json` diz que virou PE006, mas o PE006 é outra regra. O `preferencias.json` chama de PE009, que também é outra regra.
   - O montador olha o culto de louvor anterior, conta inclusive o regente, e dá aviso.
   - O auditor olha cultos com até 2 dias de distância e dá erro.
   - Nenhum dos dois olha a virada do mês.
   - Decisão de 05/11: preferência; evitar quando houver bastante gente. Falta documentar.

## C. Cultos de departamento e convidados

8. **O que define um culto departamental (RF015).**
   - O montador decide pelo PREGADOR: se o pregador é departamento, publica o departamento nos 3 campos.
   - O auditor decide pelo REGENTE.
   - Em outubro não seguimos nenhum dos dois: em 10/10 o pregador foi PR. HOFNI e o louvor foi dos JOVENS; em 31/10 o pregador foi QUARTETO e a equipe foi nossa.
   - Decidir: o critério; e se um departamento pode assumir só a MM.
9. **Convidados na MM** (Coral Kids, Jhon e Andreia, Quarteto, Voz Juvenil). O auditor aceita por uma lista fixa. No montador, nome fora do cadastro é **bloqueio**, e cadastrado sem telefone também trava a publicação.
   - Decidir: como o sucessor deve lançar convidados.
10. **Listas de departamentos.** Existem 8 versões diferentes no código. "MM", "MORDOMIA" e "VOZ JUVENIL" não estão em nenhuma. O Fabrício tem "JOVENS" como apelido, então o sistema conta o louvor dos Jovens como regência dele e pode mandar WhatsApp para ele.
   - Decidir: a lista oficial; o que significa "MM" como pregador; tirar o apelido JOVENS do Fabrício?

## D. Dados do cadastro

11. **O campo `incentivo` (Bernardo, Vanderley, Rosana, Laura, Manu C., Manu S.) é apagado** quando a pessoa é editada no montador (`montador/lib/pessoas.mjs`, `montarPessoa`). Nenhum código usa o intervalo de meses.
   - Decidir: manter? Trocar por `perfil_canto`?
12. **Perfil "participação"**: 20 pessoas, incluindo regentes (Jessie, Joás, Ariadny). O REGRAS.md diz "no máximo 1 vez por mês", mas nenhuma ferramenta bloqueia ou avisa.
   - Decidir: o critério e o limite.
13. **Afastamentos vencidos**: a data "até" nunca é aplicada.
   - Fabiola, Igor e Junior continuam afastados com data passada.
   - A RP018 diz que Gabriel P. está afastado, mas ele está ativo e cantando.
   - Decidir: atualizar.
14. **Regras só no legado `docs/regras`**:
    - Yasser rege só em último caso, a cada 2 meses.
    - Lidiane canta a cada 2 meses.
    - Roni não deve cantar perto da publicação.
    - Vanderley só sábado, a cada 3 meses. O cadastro não tem essa restrição.
    - Bernardo e as Manus não devem cantar em meses seguidos.
    - Decidir: o que continua valendo.
15. **Regras só no código ou em notas:**
    - Ariadny e Catherine não cantam domingo. Os números RP007 e RP017 no código não batem com o REGRAS.md.
    - Luiz da Silva e Ariadny não juntos (aviso vindo do `resumo.md`).
    - Gabriel P.: "1 sábado na equipe".
    - Luiz Antonio não é regente.
    - Henrique não canta.
    - Decidir: oficializar ou descartar cada uma.

## E. Publicação

16. **BANDA ou PB.** O script de publicação põe BANDA no sábado e no domingo. O montador põe sábado BANDA e domingo PB, que é a prática.
    - Decisão de 05/11: sábado BANDA, domingo PB, quarta PB, salvo pedido do diretor. Falta documentar e corrigir o script.
17. **Exceções.** No auditor, a exceção é a palavra "EXCECAO" escrita no OBS, que é público. No montador não há como liberar um bloqueio, então a exceção "com autorização do diretor" é impossível.
    - Decidir: como registrar uma exceção autorizada.
18. **Sábado com 1 MM só** (17, 24 e 31/10). Quando o sábado tem um nome só, o montador o trata como MM da Escola Sabatina, e o histórico o conta como MM do Culto.
    - Decidir: quando o sábado pode ter 1 MM, e de qual momento é o nome.
19. **AV ou regente fazendo MM.** As duas ferramentas bloqueiam. A PE005 permite o AV quando não há outra pessoa, e o `papeis.json` permite o regente.
    - Decidir: liberar como aviso?
20. **Mínimo de homens.** O `resumo.md` diz 2, o REGRAS.md diz 1 (ideal 2), e o montador não avisa abaixo de 2. A exceção do Culto da Mulher não está implementada.
21. **Prefixo "PUBLICAR:".** O script acrescenta, o validador exige, o montador não. O texto aparece com o prefixo no site.
22. **Medida de participação.** O ICR dos scripts usa uma média ideal fixa de 3. O montador compara com a média do grupo em 4 meses.
    - Decidir: qual vale.
23. **Fontes duplicadas de regras:**
    - Dois REGRAS.md (`docs/regras` e `processos/regras`).
    - `regras.index.json` desatualizado.
    - RP007, RP018 e RP019 faltam no MD.
    - RF019 e RF020 faltam no JSON.
    - O editor do montador não atualiza o REGRAS.md.
    - O `html-revisao` e o `desktop-app` têm motores de regra próprios.
    - Decidir: qual é a fonte única, e qual ferramenta o sucessor vai usar.

## Novos pontos registrados nesta escala

24. **Giovana: não escalar em dias seguidos**, temporariamente, por ter ganhado bebê. Ainda não está no cadastro nem nas regras.
25. **Catherine: uma vez por mês, na equipe em que o Fabrício reger, se possível.**
26. **Luiz Antonio cobrindo a sonoplastia**: quando ele substitui a sonoplastia, o campo AUDIOVISUAL precisa ser atualizado. Não existe processo para isso.
