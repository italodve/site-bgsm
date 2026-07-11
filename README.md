# Site Imobiliária Vilas Cabral — Plataforma Imobiliária Integrada

Site da **Imobiliária Vilas Cabral**: site público + painel de
imóveis/leads + agente de IA (Claude) em **um único serviço com front-end e
back-end integrados**. Tudo vive num banco de dados próprio (SQLite) no
mesmo deploy — sem planilhas nem serviços externos além da API da Anthropic.

| Rota | O que é |
| --- | --- |
| `/` | Site público da Imobiliária Vilas Cabral, com chatbot |
| `/painel` | Dashboard: cadastra imóveis no site e recebe os leads do agente (login) |
| `/api/imoveis` | API pública que alimenta os cards de imóveis do site |
| `/chat`, `/chat/session`, `/lead`, `/health` | API do agente de IA (Claude) |

## Como tudo se integra

```
 Painel (/painel) ── grava imóveis ──▶ SQLite ◀── grava leads ── Chatbot (site)
        ▲                               │  │
        └───────── lê leads ────────────┘  └──── lê imóveis ────▶ Site (/) e Agente
```

1. **Painel → Site**: um imóvel cadastrado no painel aparece no site na hora
   (o site lê `/api/imoveis`; imóveis "Vendido"/"Locado" ficam ocultos).
2. **Painel → Agente**: o catálogo de imóveis é injetado no prompt do agente
   a cada mensagem — o chatbot recomenda os imóveis reais cadastrados.
3. **Agente → Painel**: quando o chatbot coleta os dados do cliente, o lead é
   salvo no banco e aparece no painel imediatamente, com funil de status
   (novo → aquecido → vendido) e exportação CSV.

## Personalização pendente

- **WhatsApp**: número oficial `+55 11 97133-1539` já aplicado. Para
  trocar no futuro, ajuste `public/script.js` (constante `numeroEmpresa`),
  os links `wa.me` de `public/index.html` e `WHATSAPP_EMPRESA` no `.env`.
- **Imagens**: as fotos em `public/*.jpg` foram geradas por IA com o
  roteiro de [`IMAGENS.md`](IMAGENS.md). Para trocar alguma, substitua o
  arquivo mantendo o mesmo nome.
- **Textos**: cidade/região de atuação já apontam para Itapevi e região
  oeste da Grande SP (dados da ficha do Google Maps:
  https://maps.app.goo.gl/2usv5HYVbec3EUPk9). Endereço completo, horário
  e CRECI podem ser acrescentados em `public/index.html` e
  `src/agent.js` quando forem confirmados.

## Stack

- **Node.js 20 + Express 5** — um único servidor serve os dois front-ends
  estáticos (HTML/CSS/JS puro, sem build step) e toda a API.
- **SQLite (better-sqlite3)** — banco embutido, um arquivo só. Na Railway
  ele fica num Volume e sobrevive a deploys.
- **Claude (Anthropic SDK)** — agente de atendimento com memória por sessão,
  catálogo dinâmico de imóveis e handoff para o WhatsApp.
- **1 serviço só na Railway** — sem CORS entre domínios nem serviços extras.

## Estrutura

```
├── src/
│   ├── server.js      # Express: estáticos + API pública + API do painel
│   ├── db.js          # SQLite: tabelas imoveis e leads + queries
│   ├── agent.js       # prompt do Claude + catálogo dinâmico de imóveis
│   ├── memory.js      # memória de conversa por sessão
│   └── validation.js  # validação de sessionId/mensagem
├── public/            # site público (servido em /)
│   └── painel/        # dashboard (servido em /painel, protegido por login)
├── views/login.html   # tela de login do painel
├── IMAGENS.md         # roteiro de prompts p/ gerar as imagens do site
├── railway.json       # configuração de deploy do Railway
└── package.json
```

## Rodando localmente

```bash
npm install
cp .env.example .env   # preencha ANTHROPIC_API_KEY, CHAT_SESSION_SECRET e PAINEL_PASSWORD
npm start
# http://localhost:3000         → site + chatbot
# http://localhost:3000/painel  → dashboard (login com PAINEL_USER/PAINEL_PASSWORD)
```

O banco é criado automaticamente em `./data/imob.db` na primeira execução.

## Deploy no Railway

1. Crie um projeto no Railway e conecte este repositório.
2. **Volume** (para o banco não sumir a cada deploy): no serviço, adicione um
   Volume montado em `/data`.
3. Configure as variáveis:
   - `ANTHROPIC_API_KEY` — chave da Anthropic (obrigatória para o chat)
   - `CHAT_SESSION_SECRET` — segredo longo e aleatório
   - `PAINEL_USER` / `PAINEL_PASSWORD` — credenciais do painel
     (`PAINEL_PASSWORD` é obrigatória; sem ela o painel fica bloqueado)
   - `WHATSAPP_EMPRESA` — WhatsApp oficial da Imobiliária Vilas Cabral (dígitos com DDI)
   - `DATA_DIR=/data` — aponta o banco para o Volume
4. O Railway detecta Node.js e usa o `railway.json` (start `npm start`,
   healthcheck em `/health`).
5. Em **Settings → Networking**, gere o domínio público.

## API

### Pública

- `GET /api/imoveis` — imóveis visíveis no site (exclui Vendido/Locado)
- `GET /health` — healthcheck

### Chat (usada pelo widget do site)

- `POST /chat/session` com `{ "sessionId": "user-123" }` →
  `{ "token": "...", "expiresInMs": 900000 }`
- `POST /chat` com header `X-Chat-Token` e body
  `{ "sessionId": "user-123", "message": "Olá" }` → `{ "reply": "..." }`
- `POST /lead` com header `X-Chat-Token` e body
  `{ "sessionId": "user-123", "lead": [{ "label": "Nome", "value": "Italo" }], "source": "https://site.com" }`
  → grava o lead no banco (um por sessão; envios repetidos atualizam)

### Painel (exige cookie de login)

- `GET /painel/api/imoveis` · `POST /painel/api/imoveis` ·
  `PUT /painel/api/imoveis/:id` · `DELETE /painel/api/imoveis/:id`
- `POST /painel/api/upload` — corpo é a própria imagem (JPG/PNG/WebP/GIF,
  até 5 MB, `Content-Type` da imagem) → `{ "url": "/uploads/img-…" }`
- `GET /painel/api/leads` · `PATCH /painel/api/leads/:id` (`{ "status": "novo|aquecido|vendido" }`) ·
  `DELETE /painel/api/leads/:id`

### Erros

`400` input inválido · `401` token/sessão inválidos · `404` não encontrado ·
`413` payload muito grande · `429` rate limit · `500` erro interno
