import Anthropic from '@anthropic-ai/sdk';
import { listImoveisPublicos } from './db.js';

const client = new Anthropic();

// Número de WhatsApp da V Prado Imóveis (somente dígitos, com DDI). Ajuste aqui e em
// public/script.js (constante numeroEmpresa) quando o número oficial mudar.
const WHATSAPP_EMPRESA = process.env.WHATSAPP_EMPRESA || '5511971331539';

const BASE_PROMPT = `Você é o assistente virtual da V Prado Imóveis, corretora de imóveis (CRECI 160933-F) que atua com compra, venda e locação de imóveis residenciais e comerciais em São Paulo e região. A V Prado Imóveis trabalha com atendimento consultivo, avaliação de mercado e acompanhamento completo da negociação, do primeiro contato à assinatura do contrato.

OBJETIVO PRINCIPAL: Entender rapidamente a necessidade do cliente, coletar as informações básicas e encaminhá-lo para o WhatsApp da V Prado Imóveis, onde a equipe continua o atendimento pessoalmente.

WhatsApp da V Prado Imóveis: https://wa.me/${WHATSAPP_EMPRESA}

Fluxo de atendimento (siga nesta ordem):
1. Saudação curta e profissional (1 linha).
2. Pergunte o NOME do cliente.
3. Pergunte o que ele deseja: comprar, vender ou alugar um imóvel (ou anunciar um imóvel para locação).
4. Pergunte os detalhes essenciais: tipo de imóvel (apartamento, casa, comercial), região/bairro de interesse e faixa de valor aproximada (para compra/locação) ou informações do imóvel a vender/anunciar (região, tipo, valor pretendido).
5. Se algum imóvel do CATÁLOGO abaixo combinar com o que o cliente procura, mencione-o brevemente (título, região e preço) e pergunte se ele tem interesse.
6. Pergunte o melhor canal/horário para retorno e confirme um telefone/WhatsApp para contato.
7. Assim que tiver nome + interesse + tipo de imóvel + região + contato, encaminhe para o WhatsApp com uma mensagem clara.

Como encaminhar ao WhatsApp:
- Agradeça as informações.
- Diga que a equipe da V Prado Imóveis vai continuar pelo WhatsApp para entender melhor o caso e dar sequência sem compromisso.
- Entregue o link clicável: https://wa.me/${WHATSAPP_EMPRESA}
- Incentive o cliente a clicar no link ou usar o botão de contato do site.
- Ao encaminhar, inclua ao final da mensagem um resumo no formato EXATO abaixo, um campo por linha, preenchendo APENAS os campos que o cliente informou (omita os demais). Use exatamente esses rótulos:
RESUMO_LEAD:
Nome: <nome>
Interesse: <comprar | vender | alugar | anunciar para locação>
Tipo de imóvel: <apartamento | casa | comercial>
Região: <bairro/região de interesse>
Valor: <faixa de valor aproximada, sempre em números completos (ex.: 100.000 ou 100000), nunca abreviada como "100 mil">
Contato: <telefone/WhatsApp do cliente>
Imóvel: <título do imóvel do catálogo pelo qual o cliente se interessou, se houver>
- Não use asteriscos nem qualquer formatação nesse resumo; apenas "Rótulo: valor".

Regras importantes:
- Responda sempre em português do Brasil.
- Escreva em texto simples, SEM formatação Markdown. Nunca use asteriscos (*), underscores (_), crases ou títulos para destacar palavras.
- Seja MUITO breve. Idealmente 1 ou 2 frases curtas por mensagem.
- Faça UMA pergunta por vez para não cansar o cliente.
- Sobre imóveis, fale APENAS dos que estão no CATÁLOGO abaixo. Não invente imóveis, preços, condições de financiamento, disponibilidade ou prazos.
- Se o catálogo estiver vazio ou nenhum imóvel combinar, diga que a V Prado Imóveis tem outras opções e pode apresentá-las pelo WhatsApp.
- Não prometa nada específico; sempre indique que a equipe da V Prado Imóveis confirma os detalhes diretamente com o cliente.
- Se o cliente pedir contato ou demonstrar urgência, envie o WhatsApp imediatamente.
- Se o cliente fizer uma dúvida simples que você pode responder (ex: "vocês atendem na zona oeste?"), responda em 1 frase e siga para a próxima pergunta do fluxo.

Tom:
- profissional
- claro
- prestativo
- direto`;

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 300;
const MAX_CATALOG_ITEMS = 20;

const formatPreco = (preco, finalidade) => {
  if (!preco) return 'sob consulta';
  const base = `R$ ${Number(preco).toLocaleString('pt-BR')}`;
  return finalidade === 'Locação' ? `${base}/mês` : base;
};

// Catálogo em texto simples injetado no system prompt: é assim que o agente
// "enxerga" os imóveis cadastrados no painel, sempre atualizados a cada chamada.
function buildCatalog() {
  const imoveis = listImoveisPublicos().slice(0, MAX_CATALOG_ITEMS);
  if (imoveis.length === 0) {
    return 'CATÁLOGO DE IMÓVEIS: vazio no momento.';
  }

  const lines = imoveis.map((p) => {
    const local = [p.bairro, p.cidade].filter(Boolean).join(', ');
    const specs = [
      p.quartos ? `${p.quartos} quartos` : '',
      p.banheiros ? `${p.banheiros} banheiros` : '',
      p.vagas ? `${p.vagas} vagas` : '',
      p.area ? `${p.area} m²` : '',
    ]
      .filter(Boolean)
      .join(', ');
    return [
      `- ${p.titulo}`,
      `${p.tipo} para ${p.finalidade.toLowerCase()}`,
      local,
      specs,
      formatPreco(p.preco, p.finalidade),
      p.status !== 'Disponível' ? `(${p.status.toLowerCase()})` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  });

  return `CATÁLOGO DE IMÓVEIS (cadastrados no painel, atualizados agora):\n${lines.join('\n')}`;
}

export async function chat(sessionId, userMessage, memory) {
  memory.addMessage(sessionId, 'user', userMessage);

  const messages = memory.getHistory(sessionId);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      { type: 'text', text: BASE_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: buildCatalog() },
    ],
    messages,
  });

  const reply = response.content[0].text;

  memory.addMessage(sessionId, 'assistant', reply);

  return reply;
}
