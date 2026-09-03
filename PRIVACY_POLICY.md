# Política de Privacidade — FormGen

Última atualização: 3 de setembro de 2026.

A extensão **FormGen** ("nós", "nosso") respeita a privacidade dos seus usuários. Esta política descreve como as informações são tratadas ao utilizar a extensão FormGen para Google Chrome.

---

### 1. Único Propósito
O FormGen tem como único propósito permitir que desenvolvedores, testadores de software e usuários preencham formulários web com dados sintéticos e fictícios para testes rápidos, utilizando modelos de Inteligência Artificial configurados pelo próprio usuário.

---

### 2. Coleta e Uso de Dados
- **Nenhum dado pessoal é coletado ou vendido**: O FormGen não coleta, não armazena em servidores remotos próprios e não comercializa nenhuma informação pessoal identificável dos usuários.
- **Leitura de Formulários (Conteúdo do Site)**: Quando acionado pelo usuário, a extensão inspeciona a estrutura de campos (`<input>`, `<select>`, `<textarea>`) da aba ativa para extrair apenas rótulos (labels), nomes de campos e tipos de dados necessários para solicitar os dados fictícios à IA.
- **Credenciais e Chaves de API**: As chaves de API informadas pelo usuário (Google Gemini, OpenAI, etc.) e as preferências da extensão são armazenadas exclusivamente no navegador do usuário utilizando as APIs nativas `chrome.storage.sync` e `chrome.storage.local`. Nós não temos acesso a essas chaves.
- **Comunicação com Provedores de IA**: As requisições de geração de dados são enviadas diretamente do navegador do usuário para o endpoint da IA configurado pelo próprio usuário (ex: Google, OpenAI, Ollama local), sem passar por intermediários.

---

### 3. Compartilhamento com Terceiros
Não vendemos, transferimos ou compartilhamos quaisquer dados com terceiros para fins de marketing, publicidade, análise de crédito ou empréstimos.

---

### 4. Código Remoto
A extensão não utiliza código remoto (JavaScript/Wasm executado externamente), atendendo integralmente aos padrões do Manifest V3 da Chrome Web Store.

---

### 5. Contato
Para dúvidas sobre esta política de privacidade, visite o repositório oficial do projeto:
https://github.com/JoaoVictorOAS/gerarForms
