# Original User Request

## 2026-09-03T14:23:30Z

Extensão Chrome (Manifest V3) que inspeciona formulários web em tempo de execução, gera dados sintéticos realistas e estruturados utilizando IA multi-provedor (Gemini, OpenAI, Ollama ou APIs compatíveis com chave e endpoint configuráveis), e realiza o preenchimento automático individual ou em lotes (10 e 100 registros) gerenciados por uma fila persistida no navegador.

Working directory: /home/JoaoVictor/projetos/FormGen
Integrity mode: development

## Requirements

### R1. Inspeção e Extração Sanitizada de Formulários (DOM Scanner)
Analisar campos de formulário na aba web ativa e produzir um schema JSON enxuto (identificadores, labels correspondentes, tipos de input, opções válidas de selects e restrições como required, min, max, pattern), sem transmitir HTML bruto ou estilos para a IA a fim de garantir máxima economia de tokens e baixa latência.

### R2. Integração com IA Multi-Provedor com Formato JSON Estrito
Suportar configuração de provedor de IA com Base URL, Modelo e API Key armazenados nas preferências da extensão (`chrome.storage.sync`). O orquestrador deve solicitar à IA o preenchimento estruturado em JSON com base no schema do formulário, com capacidade de gerar 1 registro individual ou coleções em lote (10 e 100 registros).

### R3. Gerenciamento de Fila no Navegador e Persistência
Ao gerar múltiplos registros (10 ou 100), o registro inicial (#1) deve ser imediatamente inserido no formulário da página, enquanto os registros restantes (#2 a #N) devem ser armazenados em fila no navegador (`chrome.storage.local`) vinculados à página/formulário. A interface da extensão deve exibir a opção dinâmica "Inserir registro [$numero_do_registro]" (ex: `Inserir registro [2/10]`), permitindo avançar a fila e preencher sequencialmente.

### R4. Preenchimento Automatizado e Emulação de Eventos
Preencher os campos correspondentes no DOM com os dados do registro acionado, manipulando adequadamente inputs de texto, números, selects, radio buttons, checkboxes e textareas, garantindo o disparo de eventos sintéticos (`input`, `change`, `blur`) para acionar reatividade em SPAs (React, Vue, Angular) e formulários legados.

### R5. Suite de Verificação com Fixture HTML Integrada
Fornecer uma página HTML de teste contendo formulários com variados tipos de campos, regras de validação e comportamentos de eventos, acompanhada de scripts de teste/verificação automatizada que validem a extração do schema, a geração estruturada, o enfileiramento e a injeção dos dados nos inputs sem intervenção manual.

### R6. Governança de Código, Autoria Git e Manutenção do Graphify
Todos os commits gerados no repositório devem obrigatoriamente manter a autoria de `JoaoVictorOAS <playerthejvs@gmail.com>`. As regras do Graphify em `.agents/rules/graphify.md` devem ser respeitadas, mantendo o grafo de conhecimento e a indexação do repositório sempre atualizados via `graphify update .`.

## Acceptance Criteria

### Extração do Schema e DOM
- [ ] Executar o scanner contra a página de teste fixture e obter um JSON estruturado contendo todos os campos detectáveis (text, email, number, select, radio, checkbox, textarea) com seus respectivos labels e tipos.
- [ ] O payload de schema gerado não deve conter código HTML bruto, tags de estilo ou scripts.

### Integração com IA e Resposta Estruturada
- [ ] Tela de opções/configurações permite salvar e persistir API Key, Base URL e Modelo em `chrome.storage.sync`.
- [ ] A chamada à IA retorna JSON estritamente validado com chaves correspondentes aos campos do formulário para 1, 10 ou 100 registros.

### Mecânica de Fila e Inserção Sequencial
- [ ] Ao solicitar 1 registro: o formulário da página é preenchido e nenhuma fila pendente permanece em `chrome.storage.local`.
- [ ] Ao solicitar 10 registros: o registro #1 é injetado no formulário e os 9 registros subsequentes são persistidos no storage local.
- [ ] O botão na interface exibe dinamicamente `Inserir registro [2/10]` e, ao ser clicado, injeta o registro #2 e avança o contador para `Inserir registro [3/10]`.
- [ ] Os campos preenchidos disparam os eventos nativos `input` e `change`, refletindo os valores injetados em listeners de eventos da página.

### Verificação Automatizada e Qualidade
- [ ] A suite de testes automatizada executa contra a fixture HTML e passa 100% dos testes de ponta a ponta sem falhas.
- [ ] A autoria de todos os commits registrados permanece `JoaoVictorOAS <playerthejvs@gmail.com>`.
- [ ] O grafo de conhecimento do projeto é mantido atualizado pelo `graphify`.
