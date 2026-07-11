/* =========================================================================
 * Painel Imobiliária Vilas Cabral — cadastro de imóveis e gestão de leads
 *
 * Todos os dados vivem no banco de dados do próprio servidor, acessado pela
 * API /painel/api/* (protegida pelo login). Os imóveis cadastrados aqui
 * aparecem no site público na hora; os leads chegam automaticamente pelo
 * chat do site (agente de IA).
 * ========================================================================= */
const API = "/painel/api";

const LEAD_STATUSES = ["novo", "aquecido", "vendido"];
const LEAD_STATUS_LABEL = { novo: "Lead novo", aquecido: "Lead aquecido", vendido: "Lead vendido" };

/* ---------- utilidades ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Chamada à API do painel. Sessão expirada (401) manda de volta ao login.
async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (res.status === 401) {
    window.location.href = "/painel/login";
    throw new Error("Sessão expirada");
  }
  if (!res.ok) {
    let message = `Erro ${res.status}`;
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch {
      /* resposta sem corpo JSON */
    }
    throw new Error(message);
  }

  return res.status === 204 ? null : res.json();
}

const formatBRL = (value) => {
  const n = Number(value);
  if (!value || Number.isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
};

const escapeHtml = (str) =>
  String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const formatDate = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const leadName = (fields) => {
  const nome = fields.find((f) => /nome/i.test(f.label));
  return (nome ? nome.value : fields[0] && fields[0].value) || "Lead";
};

// Formata o valor do lead como moeda APENAS quando ele é puramente numérico
// (ex.: "100000", "100.000", "R$ 100.000,00"). Texto como "100 mil" ou
// "entre 300 e 400 mil" é exibido como veio — antes, remover os não-dígitos
// transformava "100 mil" em R$ 100.
const formatLeadValor = (raw) => {
  const s = String(raw ?? "").trim();
  if (!/^R?\$?\s*[\d.,\s]+$/i.test(s)) return s;
  const digits = s
    .replace(/[^\d,]/g, "")
    .replace(/,\d{1,2}$/, "") // descarta centavos (",00")
    .replace(/,/g, "");
  const n = Number(digits);
  if (!digits || Number.isNaN(n)) return s;
  return formatBRL(n);
};

// Tags com os demais dados (valor formatado como moeda quando numérico).
const leadTagsHtml = (fields) =>
  fields
    .filter((f) => !/nome/i.test(f.label))
    .map((f) => {
      const value = /valor|pre[çc]o/i.test(f.label) ? formatLeadValor(f.value) : f.value;
      return `<span class="pl-tag">${escapeHtml(value)}</span>`;
    })
    .join("");

// Texto plano dos campos do lead (para busca e exportação CSV).
const leadDataText = (fields) => fields.map((f) => `${f.label}: ${f.value}`).join(" | ");

let toastTimer;
const toast = (message) => {
  const el = $("[data-toast]");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
};

/* ---------- estado ---------- */
const state = {
  properties: [],
  leads: []
};

/* ---------- carregamento ---------- */
async function loadAll() {
  try {
    [state.properties, state.leads] = await Promise.all([api("/imoveis"), api("/leads")]);
    setConnection(true);
  } catch (err) {
    console.warn("Falha ao carregar dados:", err.message);
    setConnection(false);
  }
  renderAll();
}

function setConnection(online) {
  const dot = $("[data-conn-dot]");
  dot.classList.toggle("is-online", online);
  dot.classList.toggle("is-cloud", online);
  $("[data-conn-label]").textContent = online ? "Conectado" : "Sem conexão";
}

/* ---------- render: VISÃO GERAL ---------- */
function renderOverview() {
  const props = state.properties;
  const available = props.filter((p) => p.status === "Disponível").length;
  const newLeads = state.leads.filter((l) => l.status === "novo").length;

  $('[data-kpi="properties"]').textContent = props.length;
  $('[data-kpi="available"]').textContent = available;
  $('[data-kpi="leads"]').textContent = state.leads.length;
  $('[data-kpi="newLeads"]').textContent = newLeads;

  const statuses = ["Disponível", "Reservado", "Vendido", "Locado"];
  const max = Math.max(1, ...statuses.map((s) => props.filter((p) => p.status === s).length));
  $("[data-status-chart]").innerHTML = statuses
    .map((s) => {
      const count = props.filter((p) => p.status === s).length;
      return `<div class="bar-item"><span>${s}</span><div class="bar-track"><div class="bar-fill" style="width:${
        (count / max) * 100
      }%"></div></div><b>${count}</b></div>`;
    })
    .join("");

  renderPipeline();
}

// Funil de leads: uma coluna por etapa (novo / aquecido / vendido), com os
// leads dentro e a opção de mover de etapa ali mesmo.
function renderPipeline() {
  const board = $("[data-pipeline]");
  if (state.leads.length === 0) {
    board.innerHTML =
      '<p class="empty-state">Sem leads ainda. Eles chegam automaticamente pelo chat do site.</p>';
    return;
  }

  board.innerHTML = LEAD_STATUSES.map((status) => {
    const leads = state.leads.filter((l) => l.status === status);
    const cards = leads
      .map((l) => {
        const meta = [formatDate(l.createdAt), l.source].filter(Boolean).map(escapeHtml).join(" · ");
        const options = LEAD_STATUSES.map(
          (s) => `<option value="${s}" ${s === status ? "selected" : ""}>${LEAD_STATUS_LABEL[s]}</option>`
        ).join("");
        return `<div class="pl-card" draggable="true" data-lead-id="${l.id}">
          <div class="pl-card-head">
            <p class="pl-name">${escapeHtml(leadName(l.fields))}</p>
            <button class="pl-delete" data-delete-lead="${l.id}" type="button" title="Excluir lead">×</button>
          </div>
          <div class="pl-tags">${leadTagsHtml(l.fields)}</div>
          ${meta ? `<small>${meta}</small>` : ""}
          <select class="lead-status-select" data-lead-status="${l.id}">${options}</select>
        </div>`;
      })
      .join("");
    return `<div class="pl-col pl-${status}" data-status="${status}">
      <div class="pl-col-head"><span>${LEAD_STATUS_LABEL[status]}</span><b>${leads.length}</b></div>
      <div class="pl-col-body">${cards || '<p class="pl-empty">Solte um lead aqui</p>'}</div>
    </div>`;
  }).join("");
}

/* ---------- render: IMÓVEIS ---------- */
function renderProperties() {
  const term = $("[data-property-search]").value.trim().toLowerCase();
  const filter = $("[data-property-filter]").value;
  const grid = $("[data-property-grid]");

  const list = state.properties.filter((p) => {
    const matchTerm =
      !term ||
      [p.titulo, p.bairro, p.cidade, p.tipo].some((v) => String(v || "").toLowerCase().includes(term));
    const matchStatus = !filter || p.status === filter;
    return matchTerm && matchStatus;
  });

  $("[data-property-empty]").hidden = state.properties.length !== 0;

  grid.innerHTML = list
    .map((p) => {
      const photo = p.foto
        ? `<div class="property-photo" style="background-image:url('${escapeHtml(p.foto)}')"></div>`
        : `<div class="property-photo">${escapeHtml(p.tipo || "Imóvel")}</div>`;
      const meta = [
        p.quartos ? `${p.quartos} quartos` : "",
        p.banheiros ? `${p.banheiros} banh.` : "",
        p.vagas ? `${p.vagas} vagas` : "",
        p.area ? `${p.area} m²` : ""
      ]
        .filter(Boolean)
        .map((m) => `<span>${escapeHtml(m)}</span>`)
        .join("");
      return `<article class="property-card">
        ${photo}
        <div class="property-body">
          <span class="badge ${escapeHtml(p.status)}">${escapeHtml(p.status)} · ${escapeHtml(p.finalidade || "")}</span>
          <h3>${escapeHtml(p.titulo)}</h3>
          <span class="property-price">${formatBRL(p.preco)}</span>
          <div class="property-meta"><span>${escapeHtml([p.bairro, p.cidade].filter(Boolean).join(", ") || "—")}</span></div>
          <div class="property-meta">${meta}</div>
          <div class="card-actions">
            <button class="button ghost" data-edit="${p.id}">Editar</button>
            <button class="button ghost" data-delete="${p.id}">Excluir</button>
          </div>
        </div>
      </article>`;
    })
    .join("");
}

/* ---------- render: LEADS ---------- */
function renderLeads() {
  const term = $("[data-lead-search]").value.trim().toLowerCase();
  const filter = $("[data-lead-filter]").value;
  const tbody = $("[data-lead-rows]");

  const list = state.leads.filter((l) => {
    const matchTerm =
      !term ||
      [leadDataText(l.fields), l.source, l.createdAt].some((v) =>
        String(v || "").toLowerCase().includes(term)
      );
    const matchStatus = !filter || l.status === filter;
    return matchTerm && matchStatus;
  });

  $("[data-lead-empty]").hidden = state.leads.length !== 0;

  tbody.innerHTML = list
    .map((l) => {
      const options = LEAD_STATUSES.map(
        (s) => `<option value="${s}" ${s === l.status ? "selected" : ""}>${LEAD_STATUS_LABEL[s]}</option>`
      ).join("");
      const dataHtml = l.fields.length
        ? `<strong class="lead-name">${escapeHtml(leadName(l.fields))}</strong><div class="pl-tags">${leadTagsHtml(l.fields)}</div>`
        : "—";
      return `<tr>
        <td>${escapeHtml(formatDate(l.createdAt) || "—")}</td>
        <td class="lead-data">${dataHtml}</td>
        <td>${escapeHtml(l.source || "—")}</td>
        <td><select class="lead-status-select" data-lead-status="${l.id}">${options}</select></td>
        <td><button class="button ghost" data-delete-lead="${l.id}" type="button">Excluir</button></td>
      </tr>`;
    })
    .join("");
}

function renderAll() {
  renderOverview();
  renderProperties();
  renderLeads();
}

/* ---------- exportação CSV ---------- */
function downloadCsv(filename, rows) {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

/* ---------- modal de imóvel ---------- */
const modal = $("[data-modal]");
const propertyForm = $("[data-property-form]");

function openPropertyModal(property) {
  propertyForm.reset();
  $("[data-modal-title]").textContent = property ? "Editar imóvel" : "Novo imóvel";
  const hint = $("[data-foto-hint]");
  hint.textContent = "JPG, PNG, WebP ou GIF até 5 MB. Enviar um arquivo substitui a foto atual.";
  if (property) {
    Object.entries(property).forEach(([key, value]) => {
      if (propertyForm.elements[key]) propertyForm.elements[key].value = value ?? "";
    });
    // Foto enviada por arquivo não cabe no campo de URL (validação do input);
    // deixamos vazio e o submit mantém a foto atual se nada for informado.
    if (property.foto && property.foto.startsWith("/uploads/")) {
      propertyForm.elements.foto.value = "";
      hint.textContent = "Este imóvel já tem uma foto enviada. Escolha um arquivo apenas se quiser substituí-la.";
    }
  } else {
    propertyForm.elements.id.value = "";
  }
  modal.hidden = false;
}
const closeModal = () => (modal.hidden = true);

// Envia o arquivo de foto para o servidor e devolve o caminho público
// (/uploads/...), que vai no campo "foto" do imóvel.
const MAX_FOTO_BYTES = 5 * 1024 * 1024;
async function uploadFoto(file) {
  const res = await fetch(`${API}/upload`, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file
  });

  if (res.status === 401) {
    window.location.href = "/painel/login";
    throw new Error("Sessão expirada");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data.url;
}

propertyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(propertyForm);
  const data = Object.fromEntries(formData.entries());
  const id = data.id;
  delete data.id;
  delete data.fotoArquivo;

  const file = propertyForm.elements.fotoArquivo?.files?.[0];
  if (file && file.size > MAX_FOTO_BYTES) {
    toast("A foto deve ter no máximo 5 MB.");
    return;
  }

  try {
    if (file) {
      toast("Enviando foto…");
      data.foto = await uploadFoto(file);
    } else if (!data.foto) {
      // Sem arquivo novo e sem URL digitada: mantém a foto atual na edição.
      const current = id && state.properties.find((p) => p.id === id);
      if (current?.foto) data.foto = current.foto;
    }

    if (id) {
      await api(`/imoveis/${encodeURIComponent(id)}`, { method: "PUT", body: data });
    } else {
      await api("/imoveis", { method: "POST", body: data });
    }
    state.properties = await api("/imoveis");
    closeModal();
    renderAll();
    toast("Imóvel salvo. Já está no site.");
  } catch (err) {
    toast(`Não foi possível salvar: ${err.message}`);
  }
});

/* ---------- navegação ---------- */
function switchView(view) {
  $$("[data-view]").forEach((el) => el.classList.toggle("is-active", el.dataset.view === view));
  $$("[data-view-link]").forEach((el) => el.classList.toggle("is-active", el.dataset.viewLink === view));
  const titles = { overview: "Visão geral", properties: "Imóveis", leads: "Leads" };
  $("[data-view-title]").textContent = titles[view] || "";
  $("[data-sidebar]").classList.remove("is-open");
}

/* ---------- eventos ---------- */
function bindEvents() {
  $$("[data-view-link]").forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.viewLink)));
  $("[data-menu-toggle]").addEventListener("click", () => $("[data-sidebar]").classList.toggle("is-open"));
  $("[data-new-property]").addEventListener("click", () => openPropertyModal(null));
  $("[data-refresh]").addEventListener("click", () => {
    toast("Atualizando…");
    loadAll();
  });
  $$("[data-modal-close]").forEach((btn) => btn.addEventListener("click", closeModal));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  $("[data-property-search]").addEventListener("input", renderProperties);
  $("[data-property-filter]").addEventListener("change", renderProperties);
  $("[data-lead-search]").addEventListener("input", renderLeads);
  $("[data-lead-filter]").addEventListener("change", renderLeads);

  // ações nos cards de imóveis (delegação)
  $("[data-property-grid]").addEventListener("click", async (e) => {
    const editId = e.target.getAttribute("data-edit");
    const deleteId = e.target.getAttribute("data-delete");
    if (editId) openPropertyModal(state.properties.find((p) => p.id === editId));
    if (deleteId && confirm("Excluir este imóvel? Ele sai do site também.")) {
      try {
        await api(`/imoveis/${encodeURIComponent(deleteId)}`, { method: "DELETE" });
        state.properties = state.properties.filter((p) => p.id !== deleteId);
        renderAll();
        toast("Imóvel excluído.");
      } catch (err) {
        toast(`Não foi possível excluir: ${err.message}`);
      }
    }
  });

  // remoção de lead — tanto na tabela quanto no funil da visão geral
  const onLeadDeleteClick = async (e) => {
    const deleteId = e.target.getAttribute("data-delete-lead");
    if (!deleteId) return;
    if (!confirm("Excluir este lead? Esta ação não pode ser desfeita.")) return;
    try {
      await api(`/leads/${deleteId}`, { method: "DELETE" });
      state.leads = state.leads.filter((l) => String(l.id) !== deleteId);
      renderAll();
      toast("Lead excluído.");
    } catch (err) {
      toast(`Não foi possível excluir: ${err.message}`);
    }
  };
  $("[data-lead-rows]").addEventListener("click", onLeadDeleteClick);

  const setLeadStatus = async (id, status) => {
    if (!id || !LEAD_STATUSES.includes(status)) return;
    const lead = state.leads.find((l) => String(l.id) === String(id));
    if (!lead || lead.status === status) return;
    const previous = lead.status;
    lead.status = status;
    renderOverview();
    renderLeads();
    try {
      await api(`/leads/${id}`, { method: "PATCH", body: { status } });
    } catch (err) {
      lead.status = previous;
      renderOverview();
      renderLeads();
      toast(`Não foi possível mover o lead: ${err.message}`);
    }
  };

  // status dos leads — tanto na tabela quanto no funil da visão geral
  const onLeadStatusChange = (e) => {
    const id = e.target.getAttribute("data-lead-status");
    if (id) setLeadStatus(id, e.target.value);
  };
  $("[data-lead-rows]").addEventListener("change", onLeadStatusChange);
  const pipeline = $("[data-pipeline]");
  pipeline.addEventListener("change", onLeadStatusChange);
  pipeline.addEventListener("click", onLeadDeleteClick);

  // Arrastar leads entre as colunas do funil.
  pipeline.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".pl-card");
    if (!card) return;
    e.dataTransfer.setData("text/plain", card.dataset.leadId);
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("is-dragging");
  });
  pipeline.addEventListener("dragend", (e) => e.target.closest(".pl-card")?.classList.remove("is-dragging"));
  pipeline.addEventListener("dragover", (e) => {
    const col = e.target.closest(".pl-col");
    if (!col) return;
    e.preventDefault();
    $$(".pl-col").forEach((c) => c.classList.toggle("is-drop", c === col));
  });
  pipeline.addEventListener("dragleave", (e) => {
    if (!pipeline.contains(e.relatedTarget)) $$(".pl-col").forEach((c) => c.classList.remove("is-drop"));
  });
  pipeline.addEventListener("drop", (e) => {
    const col = e.target.closest(".pl-col");
    $$(".pl-col").forEach((c) => c.classList.remove("is-drop"));
    if (!col) return;
    e.preventDefault();
    setLeadStatus(e.dataTransfer.getData("text/plain"), col.dataset.status);
  });

  $("[data-export-properties]").addEventListener("click", () => {
    const header = ["Título", "Tipo", "Finalidade", "Status", "Preço", "Bairro", "Cidade", "Quartos", "Banheiros", "Vagas", "Área", "Descrição"];
    const rows = state.properties.map((p) => [p.titulo, p.tipo, p.finalidade, p.status, p.preco, p.bairro, p.cidade, p.quartos, p.banheiros, p.vagas, p.area, p.descricao]);
    downloadCsv("imoveis-vilascabral.csv", [header, ...rows]);
  });

  $("[data-export-leads]").addEventListener("click", () => {
    const header = ["Data", "Dados", "Origem", "Status"];
    const rows = state.leads.map((l) => [l.createdAt, leadDataText(l.fields), l.source, LEAD_STATUS_LABEL[l.status]]);
    downloadCsv("leads-vilascabral.csv", [header, ...rows]);
  });
}

/* ---------- init ---------- */
bindEvents();
loadAll();
