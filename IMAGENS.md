# Roteiro de imagens do site V Prado Imóveis (Google Flow)

As imagens do site em `public/*.jpg` foram geradas com este roteiro no
Google Flow. Para regenerar ou trocar alguma, use o script abaixo e
substitua o arquivo correspondente em
`public/` **mantendo exatamente o mesmo nome** — nada mais precisa
mudar no código.

São **9 imagens**. Depois de gerar, salve/exporte cada uma em JPG com o
nome indicado (se vier em PNG, converta ou renomeie).

---

## Script para colar no agente do Google Flow

```
Você vai gerar 9 imagens fotorrealistas para o site de uma imobiliária
brasileira chamada V Prado Imóveis. Gere UMA imagem por vez,
na ordem, seguindo o estilo global e o prompt específico de cada uma.

ESTILO GLOBAL (aplique em todas as imagens):
- Fotografia realista de arquitetura/lifestyle, aparência de câmera
  full-frame com lente 35mm, foco nítido, leve profundidade de campo.
- Luz natural quente de fim de tarde (golden hour) ou interiores bem
  iluminados por luz de janela.
- Paleta da marca: grafite/cinza-escuro, tons de dourado/champanhe e
  neutros claros (linho, areia, off-white). Madeira clara e vegetação
  são bem-vindas como apoio.
- Contexto brasileiro contemporâneo (arquitetura e urbanismo do Brasil,
  padrão São Paulo e região metropolitana).
- SEM texto, SEM logotipos, SEM placas legíveis, SEM marca d'água.
- Pessoas apenas quando o prompt pedir, sempre de costas, de lado ou
  desfocadas — sem rosto em close identificável.
- Sem distorções de arquitetura (linhas verticais retas), sem olho de
  peixe, sem HDR exagerado.

IMAGEM 1 — hero.jpg — proporção 3:4 (vertical)
Fachada de uma casa residencial brasileira contemporânea de dois
andares ao entardecer, volumes retos, revestimento de madeira clara e
concreto, grandes janelas de vidro com luz interna acesa em tom quente,
jardim tropical bem cuidado em primeiro plano, céu de golden hour,
composição vertical elegante.

IMAGEM 2 — sobre.jpg — proporção 4:3 (horizontal)
Interior de um escritório imobiliário boutique moderno: mesa de reunião
de madeira clara, cadeiras cinza-escuras, parede com plantas, luz
natural entrando pela janela; duas pessoas de negócios vistas de
costas/perfil conversando sobre plantas de imóveis impressas na mesa,
clima profissional e acolhedor.

IMAGEM 3 — servico-compra.jpg — proporção 4:3 (horizontal)
Corretor de imóveis mostrando uma sala de estar ampla e iluminada a um
casal jovem visto de costas, portas de vidro abertas para um quintal
verde, interior contemporâneo brasileiro em tons neutros com detalhes
em dourado e madeira, sensação de descoberta do imóvel ideal.

IMAGEM 4 — servico-venda.jpg — proporção 4:3 (horizontal)
Mesa de madeira clara vista de cima em ângulo, mãos assinando um
contrato de venda de imóvel com caneta elegante, chaves de casa e uma
pequena maquete/miniatura de casa ao lado, luz de janela suave, fundo
desfocado de escritório com plantas, sem rostos.

IMAGEM 5 — servico-locacao.jpg — proporção 4:3 (horizontal)
Close nas mãos de um corretor entregando um molho de chaves com
chaveiro de couro a um inquilino, ao fundo (desfocado) a porta de
entrada aberta de um apartamento claro e vazio recém-pintado, luz
natural, clima de recomeço, sem rostos.

IMAGEM 6 — imovel-casa.jpg — proporção 4:3 (horizontal)
Casa térrea brasileira em condomínio, fachada branca com detalhes em
madeira, garagem para dois carros, gramado verde aparado e calçada
limpa, céu azul de manhã, fotografia de anúncio imobiliário premium.

IMAGEM 7 — imovel-apartamento.jpg — proporção 4:3 (horizontal)
Sala de estar de apartamento reformado e compacto, sofá em tom neutro
com almofadas em tons terrosos, piso de madeira clara, varanda com vista
urbana ao fundo, muita luz natural, decoração minimalista brasileira.

IMAGEM 8 — imovel-comercial.jpg — proporção 4:3 (horizontal)
Sala comercial/loja vazia pronta para uso, ampla vitrine de vidro para
uma rua arborizada, piso cinza polido, paredes brancas recém-pintadas,
iluminação embutida acesa, aspecto de ponto comercial valorizado.

IMAGEM 9 — depoimento.jpg — proporção 3:4 (vertical)
Pessoa vista de costas/ombro segurando chaves novas em frente à porta
de entrada de sua casa nova, sorriso sugerido pelo gesto (sem rosto
visível), porta de madeira e plantas na entrada, luz quente de fim de
tarde, clima de conquista.
```

---

## Conferência rápida

| Arquivo | Proporção | Onde aparece |
| --- | --- | --- |
| `hero.jpg` | 3:4 vertical | Topo do site (moldura em arco) |
| `sobre.jpg` | 4:3 | Seção "Quem somos" |
| `servico-compra.jpg` | 4:3 | Card Serviços · Compra |
| `servico-venda.jpg` | 4:3 | Card Serviços · Venda |
| `servico-locacao.jpg` | 4:3 | Card Serviços · Locação |
| `imovel-casa.jpg` | 4:3 | Card fallback de imóvel (casa) |
| `imovel-apartamento.jpg` | 4:3 | Card fallback de imóvel (apartamento) |
| `imovel-comercial.jpg` | 4:3 | Card fallback de imóvel (comercial) |
| `depoimento.jpg` | 3:4 vertical | Seção de depoimento |

Observações:

- O CSS usa `object-fit: cover`, então pequenas variações de proporção
  são cortadas automaticamente sem quebrar o layout.
- Se o Flow gerar em outra proporção, priorize manter o **assunto
  centralizado** na imagem.
- Imagens dos imóveis reais cadastrados no painel são enviadas por
  upload no próprio painel (`/painel`) e não passam por este roteiro —
  estas 3 de `imovel-*.jpg` são apenas o fallback quando não há
  cadastro.
