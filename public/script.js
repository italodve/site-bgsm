const header = document.querySelector("[data-header]");
const menuButton = document.querySelector("[data-menu-button]");
const nav = document.querySelector("[data-nav]");
const form = document.querySelector(".contact-form");
const chatbot = document.querySelector("[data-chatbot]");
const chatbotToggle = document.querySelector("[data-chatbot-toggle]");
const chatbotClose = document.querySelector("[data-chatbot-close]");
const chatbotBody = document.querySelector("[data-chatbot-body]");
const chatbotForm = document.querySelector("[data-chatbot-form]");
const chatbotInput = document.querySelector("[data-chatbot-input]");
const chatbotQuestion = document.querySelector("[data-chatbot-question]");
// WhatsApp da Imobiliária Vilas Cabral (somente dígitos, com DDI). Se mudar,
// mantenha igual ao WHATSAPP_EMPRESA do backend.
const numeroEmpresa = "5511971331539";

// URL base do backend ai-agent. Vazio = mesma origem (o site e a API sao
// servidos pelo mesmo servidor no monorepo). Preencha apenas se a API
// estiver em outro dominio.
const AI_AGENT_BASE_URL = "";

const setHeaderState = () => {
  header?.classList.toggle("is-scrolled", window.scrollY > 24);
};

const closeMenu = () => {
  header?.classList.remove("is-open");
  document.body.classList.remove("menu-open");
  menuButton?.setAttribute("aria-label", "Abrir menu");
  menuButton?.setAttribute("aria-expanded", "false");
};

window.addEventListener("scroll", setHeaderState, { passive: true });
setHeaderState();

menuButton?.addEventListener("click", () => {
  const willOpen = !header.classList.contains("is-open");
  header.classList.toggle("is-open", willOpen);
  document.body.classList.toggle("menu-open", willOpen);
  menuButton.setAttribute("aria-label", willOpen ? "Fechar menu" : "Abrir menu");
  menuButton.setAttribute("aria-expanded", String(willOpen));
});

nav?.addEventListener("click", (event) => {
  if (event.target instanceof HTMLAnchorElement) closeMenu();
});

// Revelação suave dos blocos conforme entram na viewport. Respeita a
// preferência de movimento reduzido e degrada com tudo visível caso o
// IntersectionObserver não exista.
const revealTargets = document.querySelectorAll("[data-reveal]");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (prefersReducedMotion || !("IntersectionObserver" in window)) {
  revealTargets.forEach((el) => el.classList.add("is-visible"));
} else {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.14, rootMargin: "0px 0px -8% 0px" }
  );

  revealTargets.forEach((el) => revealObserver.observe(el));
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const nome = data.get("nome") || "";
  const telefone = data.get("telefone") || "";
  const interesse = data.get("interesse") || "";
  const mensagem = data.get("mensagem") || "";

  const texto = [
    "Olá, equipe da Imobiliária Vilas Cabral!",
    `Meu nome é ${nome}.`,
    `Meu telefone é ${telefone}.`,
    `Tenho interesse em: ${interesse}.`,
    mensagem ? `Detalhes: ${mensagem}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  window.open(`https://wa.me/${numeroEmpresa}?text=${encodeURIComponent(texto)}`, "_blank", "noopener,noreferrer");
});

// ---- Integração com o backend ai-agent (Claude) ----

// sessionId precisa casar com o padrão do backend: /^[a-zA-Z0-9-]{16,100}$/
const SESSION_ID_PATTERN = /^[a-zA-Z0-9-]{16,100}$/;
const generateSessionId = () => {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
};

// Persistência no navegador: lembra a sessão e os dados do visitante para
// não repetir perguntas em visitas futuras. Protegido para casos em que o
// localStorage está indisponível (modo privado/bloqueado).
const STORAGE_KEY = "vilascabral_chat";
const loadStored = () => {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
};
const saveStored = (data) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* localStorage indisponível: segue só em memória */
  }
};

const stored = loadStored();
const storedSessionId =
  typeof stored.sessionId === "string" && SESSION_ID_PATTERN.test(stored.sessionId)
    ? stored.sessionId
    : null;

const chatState = {
  sessionId: storedSessionId || generateSessionId(),
  returning: Boolean(storedSessionId),
  token: null,
  tokenExpiresAt: 0,
  hasStarted: false,
  sending: false,
  transcript: [], // { role: "cliente" | "assistente", text }
  lead: Array.isArray(stored.lead) ? stored.lead : [] // { label, value } acumulado
};

// Persiste sessão + dados conhecidos do visitante.
const persistChatState = () => {
  saveStored({ sessionId: chatState.sessionId, lead: chatState.lead });
};
persistChatState();

// Atualiza o lead acumulado com novos campos (sobrescreve por rótulo) e salva.
const mergeLead = (fields) => {
  if (!fields || fields.length === 0) return;
  for (const field of fields) {
    const idx = chatState.lead.findIndex((f) => f.label === field.label);
    if (idx >= 0) chatState.lead[idx] = field;
    else chatState.lead.push(field);
  }
  persistChatState();
};

// Procura um valor do lead por rótulo(s).
const leadValue = (...labels) => {
  const found = chatState.lead.find((f) => labels.includes(f.label));
  return found ? found.value : undefined;
};

// Remove marcadores de Markdown (negrito/itálico/títulos) que viriam como
// asteriscos literais, já que as mensagens são exibidas como texto puro.
const stripMarkdown = (text) =>
  String(text)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|\s)\*(\S.*?\S|\S)\*(?=\s|$)/g, "$1$2")
    .replace(/(^|\s)_(\S.*?\S|\S)_(?=\s|$)/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1");

const WHATSAPP_LINK_REGEX = /https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/\S+/i;

// Extrai o número de telefone de um link do WhatsApp (wa.me/5511... ou
// api.whatsapp.com/send?phone=5511...). Cai no número padrão se não achar.
const extractWhatsappPhone = (url) => {
  const waMe = url.match(/wa\.me\/(\d+)/i);
  if (waMe) return waMe[1];
  const apiPhone = url.match(/[?&]phone=(\d+)/i);
  if (apiPhone) return apiPhone[1];
  return numeroEmpresa;
};

// Marcador do resumo estruturado que o agente envia ao encaminhar.
const LEAD_MARKER_REGEX = /RESUMO_LEAD:?/i;

// Extrai os campos "Rótulo: valor" do bloco RESUMO_LEAD enviado pelo agente.
// Retorna uma lista de linhas já limpas, ou null se não houver bloco.
const extractLeadFields = (text) => {
  const idx = text.search(LEAD_MARKER_REGEX);
  if (idx === -1) return null;

  const fields = [];
  const linhas = text.slice(idx).replace(LEAD_MARKER_REGEX, "").split("\n");
  for (const raw of linhas) {
    const line = stripMarkdown(raw).replace(/[*_`]/g, "").replace(/^[-•]\s*/, "").trim();
    const match = line.match(/^([\wÀ-ÿ/ ]{2,40}?):\s*(.+)$/);
    if (!match) continue;
    const valor = match[2].trim();
    if (!valor || /^https?:\/\//i.test(valor) || /^<.*>$/.test(valor)) continue;
    fields.push({ label: match[1].trim().toLowerCase(), value: valor });
  }

  return fields.length ? fields : null;
};

// Formata o valor como moeda quando for um número puro; senão devolve como veio.
const formatValor = (v) => {
  const digits = v.replace(/[.\s]/g, "");
  if (/^\d+$/.test(digits)) return `R$ ${Number(digits).toLocaleString("pt-BR")}`;
  return v;
};

const tipoInteresseFrase = (t) => {
  const x = t.toLowerCase();
  if (x.includes("comprar")) return "comprar um imóvel";
  if (x.includes("vender")) return "vender um imóvel";
  if (x.includes("anunciar")) return "anunciar um imóvel para locação";
  if (x.includes("alugar")) return "alugar um imóvel";
  if (x.includes("avalia")) return "uma avaliação de imóvel";
  return `interesse: ${t}`;
};

// Monta uma mensagem natural (em frases) a partir dos campos do lead.
const composeLeadMessage = (fields) => {
  const map = {};
  for (const { label, value } of fields) map[label] = value;
  const nome = map["nome"];
  const interesse = map["interesse"] || map["tipo de espaço"] || map["tipo de espaco"];
  const tamanho = map["tamanho"] || map["m2"] || map["m²"];
  const servico = map["serviço"] || map["servico"];
  const contato = map["contato"] || map["whatsapp"] || map["telefone"];

  const frases = ["Olá, equipe da Imobiliária Vilas Cabral!"];
  frases.push(nome ? `Meu nome é ${nome} e vim pelo chat do site.` : "Vim pelo chat do site.");

  if (interesse) {
    const tipo = tipoInteresseFrase(interesse);
    frases.push(`Tenho interesse em ${tipo}.`);
  }

  if (tamanho) frases.push(`O imóvel tem aproximadamente ${tamanho} m².`);
  if (servico) frases.push(`Estou interessado em: ${servico}.`);

  // Campos extras que o agente porventura envie e não estejam no template.
  const conhecidos = new Set(["nome", "interesse", "tipo de espaço", "tipo de espaco", "tamanho", "m2", "m²", "serviço", "servico", "contato", "whatsapp", "telefone"]);
  for (const { label, value } of fields) {
    if (!conhecidos.has(label)) frases.push(`${label.charAt(0).toUpperCase()}${label.slice(1)}: ${value}.`);
  }

  if (contato) frases.push(`Meu contato é ${contato}.`);

  return frases.join(" ");
};

// Monta a mensagem personalizada para o WhatsApp. Prioriza o resumo
// estruturado do agente (rótulos) e, na falta dele, usa as respostas do cliente.
const buildWhatsappUrl = (originalUrl, leadFields) => {
  const phone = extractWhatsappPhone(originalUrl);
  let texto;

  // Usa os campos recém-extraídos ou, na falta, o lead acumulado (de agora
  // ou de visitas anteriores) já salvo no navegador.
  const fields = leadFields && leadFields.length > 0 ? leadFields : chatState.lead;

  if (fields && fields.length > 0) {
    texto = composeLeadMessage(fields);
  } else {
    const respostas = chatState.transcript
      .filter((entry) => entry.role === "cliente")
      .map((entry) => entry.text);
    texto = "Olá, equipe da Imobiliária Vilas Cabral! Vim pelo chat do site e gostaria de conversar sobre um imóvel.";
    if (respostas.length > 0) texto += ` Informei o seguinte: ${respostas.join("; ")}.`;
  }

  return `https://wa.me/${phone}?text=${encodeURIComponent(texto)}`;
};

// Cria um botão de WhatsApp dentro de uma mensagem do chat.
const appendWhatsappButton = (message, url, label = "Continuar no WhatsApp") => {
  if (!message) return;
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = "chat-whatsapp-link";
  link.textContent = label;
  message.appendChild(document.createElement("br"));
  message.appendChild(link);
};

const addChatMessage = (text, type = "bot") => {
  if (!chatbotBody) return null;

  const message = document.createElement("div");
  message.className = `chat-message ${type}`;
  message.textContent = type.startsWith("bot") ? stripMarkdown(text) : text;
  chatbotBody.appendChild(message);
  chatbotBody.scrollTop = chatbotBody.scrollHeight;
  return message;
};

// Garante um token válido (com pequena margem antes de expirar).
const ensureChatToken = async () => {
  if (chatState.token && Date.now() < chatState.tokenExpiresAt - 30000) {
    return chatState.token;
  }

  const response = await fetch(`${AI_AGENT_BASE_URL}/chat/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: chatState.sessionId })
  });

  if (!response.ok) throw new Error(`session ${response.status}`);

  const data = await response.json();
  chatState.token = data.token;
  chatState.tokenExpiresAt = Date.now() + (Number(data.expiresInMs) || 0);
  return chatState.token;
};

const sendChatMessage = async (message) => {
  const token = await ensureChatToken();

  const response = await fetch(`${AI_AGENT_BASE_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Chat-Token": token
    },
    body: JSON.stringify({ sessionId: chatState.sessionId, message })
  });

  if (response.status === 401) {
    // Token expirado/invalidado: renova uma vez e tenta de novo.
    chatState.token = null;
    const freshToken = await ensureChatToken();
    const retry = await fetch(`${AI_AGENT_BASE_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Chat-Token": freshToken
      },
      body: JSON.stringify({ sessionId: chatState.sessionId, message })
    });
    if (!retry.ok) throw new Error(`chat ${retry.status}`);
    return (await retry.json()).reply;
  }

  if (!response.ok) throw new Error(`chat ${response.status}`);
  return (await response.json()).reply;
};

const setInputEnabled = (enabled) => {
  if (chatbotInput) chatbotInput.disabled = !enabled;
  const submitButton = chatbotForm?.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = !enabled;
};

// Envia o lead para o backend salvar (fire-and-forget). Não bloqueia o
// encaminhamento ao WhatsApp e não repete envios idênticos.
const sendLead = async (fields) => {
  if (!fields || fields.length === 0) return;

  const key = JSON.stringify(fields);
  if (chatState.leadSentKey === key) return;
  chatState.leadSentKey = key;

  try {
    const token = await ensureChatToken();
    await fetch(`${AI_AGENT_BASE_URL}/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chat-Token": token },
      body: JSON.stringify({
        sessionId: chatState.sessionId,
        lead: fields,
        source: window.location.href
      })
    });
  } catch {
    // Falha ao salvar não pode atrapalhar o atendimento; ignora.
    chatState.leadSentKey = null;
  }
};

const startChat = () => {
  if (chatState.hasStarted) return;
  chatState.hasStarted = true;
  if (chatbotQuestion) {
    const nome = leadValue("nome");
    chatbotQuestion.textContent =
      chatState.returning && nome
        ? `Olá de novo, ${nome}! Que bom te ver por aqui. Quer continuar de onde paramos ou tratar de outra coisa?`
        : chatState.returning
          ? "Olá de novo! Quer continuar nossa conversa sobre o imóvel ou tratar de algo novo?"
          : "Olá! Sou o assistente da Imobiliária Vilas Cabral. Quer comprar, vender ou alugar um imóvel?";
  }
  chatbotInput?.focus();
};

chatbotToggle?.addEventListener("click", () => {
  chatbot?.classList.toggle("is-open");
  if (chatbot?.classList.contains("is-open")) startChat();
});

chatbotClose?.addEventListener("click", () => {
  chatbot?.classList.remove("is-open");
});

chatbotForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (chatState.sending) return;

  const value = chatbotInput.value.trim();
  if (!value) return;

  addChatMessage(value, "user");
  chatState.transcript.push({ role: "cliente", text: value });
  chatbotInput.value = "";
  chatState.sending = true;
  setInputEnabled(false);

  const typing = addChatMessage("Digitando…", "bot");

  try {
    const reply = await sendChatMessage(value);
    typing?.remove();
    chatState.transcript.push({ role: "assistente", text: reply });

    // Salva no navegador os dados que o agente já reconheceu, para reaproveitar
    // em visitas futuras e não repetir perguntas.
    const leadFields = extractLeadFields(reply);
    mergeLead(leadFields);

    const whatsappMatch = reply.match(WHATSAPP_LINK_REGEX);
    if (whatsappMatch) {
      // Encaminhamento: tira o link e o bloco RESUMO_LEAD do texto exibido e
      // abre o WhatsApp com uma mensagem montada a partir dos dados do cliente.
      // Também salva o lead no backend (com tudo o que foi acumulado).
      sendLead(chatState.lead.length > 0 ? chatState.lead : leadFields);
      const url = buildWhatsappUrl(whatsappMatch[0], leadFields);
      const cleanText = reply
        .replace(LEAD_MARKER_REGEX, "")
        .replace(WHATSAPP_LINK_REGEX, "")
        .split("\n")
        .filter((line) => !/^\s*[\wÀ-ÿ/ ]{2,40}?:\s*.+$/.test(line))
        .join(" ")
        .replace(/\s{2,}/g, " ")
        .trim();
      const message = addChatMessage(cleanText || "Vou te encaminhar para o WhatsApp da Imobiliária Vilas Cabral.", "bot");
      appendWhatsappButton(message, url);
      // Abre o WhatsApp automaticamente (pode ser bloqueado pelo navegador;
      // nesse caso o botão acima garante o acesso).
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      addChatMessage(reply, "bot");
    }
  } catch (error) {
    typing?.remove();
    const fallback = addChatMessage(
      "Tive um problema para responder agora. Você pode falar direto com a equipe da Imobiliária Vilas Cabral pelo WhatsApp.",
      "bot error"
    );

    const url = buildWhatsappUrl(`https://wa.me/${numeroEmpresa}`);
    appendWhatsappButton(fallback, url, "Falar no WhatsApp");
  } finally {
    chatState.sending = false;
    setInputEnabled(true);
    chatbotInput?.focus();
  }
});

// ---- Imóveis dinâmicos (alimentados pelo painel em /painel) ----
//
// Os imóveis cadastrados no painel ficam no banco de dados deste mesmo
// servidor e são lidos pela API pública /api/imoveis (que já devolve apenas
// os não vendidos/locados). Se a leitura falhar ou não houver imóveis,
// mantemos os cards de exemplo que já estão no HTML.
const escapeHtmlImovel = (str) =>
  String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Formata o preço como moeda; acrescenta "/mês" quando é locação.
const formatPreco = (valor, finalidade) => {
  const n = Number(String(valor).replace(/[^\d]/g, ""));
  if (!valor || Number.isNaN(n) || n === 0) return "Sob consulta";
  const base = n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  return /loca|alug/i.test(String(finalidade)) ? `${base}/mês` : base;
};

// Imagem de fallback conforme o tipo, quando o imóvel não tem foto própria.
const fotoPorTipo = (tipo) => {
  const t = String(tipo || "").toLowerCase();
  if (t.includes("apart")) return "imovel-apartamento.jpg";
  if (t.includes("comerc") || t.includes("sala") || t.includes("loja")) return "imovel-comercial.jpg";
  return "imovel-casa.jpg";
};

// Lê os imóveis da API do próprio servidor (alimentada pelo painel).
const fetchImoveis = async () => {
  const res = await fetch(`${AI_AGENT_BASE_URL}/api/imoveis`);
  if (!res.ok) throw new Error(`imoveis ${res.status}`);
  const imoveis = await res.json();
  return Array.isArray(imoveis) ? imoveis.filter((p) => p.titulo) : [];
};

// Monta o HTML de um card de imóvel no mesmo formato dos exemplos estáticos.
const imovelCardHtml = (p) => {
  const finalidade = /loca|alug/i.test(p.finalidade) ? "Locação" : "Venda";
  const local = [p.tipo, [p.bairro, p.cidade].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  const specs = [
    p.quartos ? `${p.quartos} quartos` : "",
    p.banheiros ? `${p.banheiros} banh.` : "",
    p.vagas ? `${p.vagas} vagas` : "",
    p.area ? `${p.area} m²` : ""
  ]
    .filter(Boolean)
    .map((s) => `<li>${escapeHtmlImovel(s)}</li>`)
    .join("");
  const foto = p.foto && /^(https?:\/\/|\/uploads\/)/i.test(p.foto) ? p.foto : fotoPorTipo(p.tipo);
  const preco = formatPreco(p.preco, p.finalidade);
  const msg = `Olá! Tenho interesse no imóvel "${p.titulo}"${local ? ` (${local})` : ""}.`;
  const whatsapp = `https://wa.me/${numeroEmpresa}?text=${encodeURIComponent(msg)}`;

  return `<article class="property-card">
      <img src="${escapeHtmlImovel(foto)}" alt="${escapeHtmlImovel(p.titulo)}" loading="lazy" />
      <div class="property-info">
        <div class="property-heading">
          <span class="property-tag">${finalidade}</span>
          ${local ? `<span class="property-location">${escapeHtmlImovel(local)}</span>` : ""}
        </div>
        <h3>${escapeHtmlImovel(p.titulo)}</h3>
        ${specs ? `<ul class="property-specs">${specs}</ul>` : ""}
      </div>
      <div class="property-cta">
        <strong class="property-price">${escapeHtmlImovel(preco)}</strong>
        <a class="button ghost small" href="${escapeHtmlImovel(whatsapp)}" target="_blank" rel="noopener noreferrer">Falar sobre este imóvel</a>
      </div>
    </article>`;
};

const carregarImoveis = async () => {
  const container = document.querySelector("[data-properties]");
  if (!container) return;

  try {
    const imoveis = await fetchImoveis();
    // Sem imóveis cadastrados: mantém os cards de exemplo já presentes no HTML.
    if (!imoveis.length) return;
    container.innerHTML = imoveis.map(imovelCardHtml).join("");
  } catch (error) {
    // Falha na leitura (API fora do ar, offline etc.): preserva o fallback.
    console.warn("Não foi possível carregar os imóveis:", error?.message || error);
  }
};

carregarImoveis();
