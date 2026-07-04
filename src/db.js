import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

// Banco SQLite único para imóveis e leads. Em produção (Railway), monte um
// volume e aponte DATA_DIR para ele para que os dados sobrevivam a deploys.
const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'imob.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS imoveis (
    id TEXT PRIMARY KEY,
    titulo TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'Apartamento',
    finalidade TEXT NOT NULL DEFAULT 'Venda',
    status TEXT NOT NULL DEFAULT 'Disponível',
    preco INTEGER,
    bairro TEXT,
    cidade TEXT,
    quartos INTEGER,
    banheiros INTEGER,
    vagas INTEGER,
    area INTEGER,
    foto TEXT,
    descricao TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    fields TEXT NOT NULL,          -- JSON: [{ "label": "...", "value": "..." }]
    source TEXT,
    status TEXT NOT NULL DEFAULT 'novo',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_imoveis_status ON imoveis(status);
  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
`);

// ---- Imóveis ---------------------------------------------------------------

const IMOVEL_TIPOS = ['Apartamento', 'Casa', 'Comercial', 'Terreno'];
const IMOVEL_FINALIDADES = ['Venda', 'Locação'];
const IMOVEL_STATUSES = ['Disponível', 'Reservado', 'Vendido', 'Locado'];
// Status que NÃO aparecem no site público nem no contexto do agente.
const IMOVEL_STATUS_OCULTOS = new Set(['Vendido', 'Locado']);

const MAX_TEXT = 300;
const MAX_DESCRICAO = 2000;
const MAX_FOTO_URL = 500;

const text = (value, max = MAX_TEXT) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const integer = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const oneOf = (value, options, fallback) => {
  const v = text(value);
  return options.includes(v) ? v : fallback;
};

// Normaliza e valida o corpo enviado pelo painel. Retorna { imovel } ou { error }.
export function sanitizeImovel(body) {
  const titulo = text(body?.titulo);
  if (!titulo) {
    return { error: 'titulo é obrigatório' };
  }

  // Aceita URL externa ou o caminho de um arquivo enviado pelo painel
  // (POST /painel/api/upload), servido em /uploads.
  const foto = text(body?.foto, MAX_FOTO_URL);
  if (foto && !/^https?:\/\//i.test(foto) && !/^\/uploads\/[\w.-]+$/.test(foto)) {
    return { error: 'foto deve ser uma URL http(s) ou um arquivo enviado pelo painel' };
  }

  return {
    imovel: {
      titulo,
      tipo: oneOf(body?.tipo, IMOVEL_TIPOS, 'Apartamento'),
      finalidade: oneOf(body?.finalidade, IMOVEL_FINALIDADES, 'Venda'),
      status: oneOf(body?.status, IMOVEL_STATUSES, 'Disponível'),
      preco: integer(body?.preco),
      bairro: text(body?.bairro),
      cidade: text(body?.cidade),
      quartos: integer(body?.quartos),
      banheiros: integer(body?.banheiros),
      vagas: integer(body?.vagas),
      area: integer(body?.area),
      foto,
      descricao: text(body?.descricao, MAX_DESCRICAO),
    },
  };
}

const listPublicStmt = db.prepare(
  `SELECT id, titulo, tipo, finalidade, status, preco, bairro, cidade,
          quartos, banheiros, vagas, area, foto, descricao
     FROM imoveis
    WHERE status NOT IN ('Vendido', 'Locado')
    ORDER BY created_at DESC`
);
const listAllStmt = db.prepare(`SELECT * FROM imoveis ORDER BY created_at DESC`);
const getImovelStmt = db.prepare(`SELECT * FROM imoveis WHERE id = ?`);
const insertImovelStmt = db.prepare(
  `INSERT INTO imoveis (id, titulo, tipo, finalidade, status, preco, bairro, cidade,
                        quartos, banheiros, vagas, area, foto, descricao)
   VALUES (@id, @titulo, @tipo, @finalidade, @status, @preco, @bairro, @cidade,
           @quartos, @banheiros, @vagas, @area, @foto, @descricao)`
);
const updateImovelStmt = db.prepare(
  `UPDATE imoveis
      SET titulo = @titulo, tipo = @tipo, finalidade = @finalidade, status = @status,
          preco = @preco, bairro = @bairro, cidade = @cidade, quartos = @quartos,
          banheiros = @banheiros, vagas = @vagas, area = @area, foto = @foto,
          descricao = @descricao, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = @id`
);
const deleteImovelStmt = db.prepare(`DELETE FROM imoveis WHERE id = ?`);

export const listImoveisPublicos = () => listPublicStmt.all();
export const listImoveis = () => listAllStmt.all();
export const getImovel = (id) => getImovelStmt.get(id);

export function createImovel(imovel) {
  const id = `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  insertImovelStmt.run({ id, ...imovel });
  return getImovelStmt.get(id);
}

export function updateImovel(id, imovel) {
  const changes = updateImovelStmt.run({ id, ...imovel }).changes;
  return changes > 0 ? getImovelStmt.get(id) : null;
}

export const deleteImovel = (id) => deleteImovelStmt.run(id).changes > 0;

// ---- Leads -----------------------------------------------------------------

export const LEAD_STATUSES = ['novo', 'aquecido', 'vendido'];

const listLeadsStmt = db.prepare(`SELECT * FROM leads ORDER BY created_at DESC`);
const insertLeadStmt = db.prepare(
  `INSERT INTO leads (session_id, fields, source) VALUES (?, ?, ?)`
);
const getLeadStmt = db.prepare(`SELECT * FROM leads WHERE id = ?`);
// Um lead por sessão: se o cliente completar o fluxo de novo (ex.: informou
// mais um dado), atualizamos o registro em vez de duplicar.
const findLeadBySessionStmt = db.prepare(
  `SELECT id FROM leads WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`
);
const updateLeadFieldsStmt = db.prepare(`UPDATE leads SET fields = ?, source = ? WHERE id = ?`);
const updateLeadStatusStmt = db.prepare(`UPDATE leads SET status = ? WHERE id = ?`);
const deleteLeadStmt = db.prepare(`DELETE FROM leads WHERE id = ?`);

const parseLead = (row) => ({
  id: row.id,
  sessionId: row.session_id,
  fields: JSON.parse(row.fields),
  source: row.source || '',
  status: row.status,
  createdAt: row.created_at,
});

export const listLeads = () => listLeadsStmt.all().map(parseLead);

export function saveLead(sessionId, fields, source) {
  const existing = findLeadBySessionStmt.get(sessionId);
  if (existing) {
    updateLeadFieldsStmt.run(JSON.stringify(fields), source || null, existing.id);
    return parseLead(getLeadStmt.get(existing.id));
  }

  const { lastInsertRowid } = insertLeadStmt.run(sessionId, JSON.stringify(fields), source || null);
  return parseLead(getLeadStmt.get(lastInsertRowid));
}

export function updateLeadStatus(id, status) {
  if (!LEAD_STATUSES.includes(status)) return false;
  return updateLeadStatusStmt.run(status, id).changes > 0;
}

export const deleteLead = (id) => deleteLeadStmt.run(id).changes > 0;

export { IMOVEL_STATUS_OCULTOS };
export default db;
