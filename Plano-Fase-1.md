# 🎮 Mini Delivery — Plano de Implementação (v3 — Final)

Todas as decisões consolidadas. Nenhum código será produzido até aprovação.

---

## Decisões Consolidadas

| # | Decisão | Impacto |
|---|---|---|
| 3.1 | Câmera com **3 níveis de zoom**: Normal (segue jogador), ~20% do mapa, 100% do mapa | Requer sistema de câmera mais robusto |
| 3.2 | Desaceleração progressiva nas interseções (sem pause literal) | Mecânica de movimento mais fluida |
| 3.3 | Passagem automática em nós com 2 conexões | Simplifica fluxo |
| 3.4 | Dead-ends: para e só permite ré | Edge case tratado |
| 3.5 | Ângulos arbitrários snap para múltiplos de 45° | Simplifica cálculo direcional |
| 3.6 | MVP com pickup (📦) + delivery (🏠) + timer | Game loop mínimo |
| 3.7 | **Mobile first** com controles touch na tela | **Mudança arquitetural significativa** |
| 3.8 | Estilo visual de mapa realista (pastéis, asfalto, linhas tracejadas) | Completamente diferente do neon proposto |
| 8.6 | Veículo inicia no centro do mapa | Posição determinística |

---

## Impactos Arquiteturais das Novas Decisões

### 🔴 Mobile First — Maior Mudança

> [!IMPORTANT]
> "Mobile first" muda fundamentalmente a abordagem. Não é um port posterior — é a plataforma primária.

**O que isso afeta:**

1. **Input System**: Não é mais `addEventListener('keydown')`. Precisa de **botões touch** desenhados como overlay no canvas (ou como elementos HTML posicionados sobre o canvas).
2. **Canvas Sizing**: `canvas.width/height` deve usar `window.innerWidth/innerHeight` com `devicePixelRatio` para telas retina.
3. **Performance**: Mobile tem GPU/CPU mais limitados. O render loop precisa ser otimizado desde o início (evitar `createLinearGradient` a cada frame, cachear draws estáticos, etc.).
4. **Layout dos Controles**: Aceleração/ré (↑↓) na **lateral direita** (vertical), direção (←→) na **parte inferior central** (horizontal).
5. **Touch Events**: `touchstart`, `touchend`, `touchmove` com `preventDefault()` para evitar scroll/zoom do browser.
6. **Viewport Meta**: `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">` para evitar zoom do browser ao tocar.

**Questão de Design: Controles como Canvas ou HTML?**

| Abordagem | Prós | Contras |
|---|---|---|
| **Canvas-drawn** (desenhar botões no canvas) | Controle total visual, sem conflito de z-index | Precisa implementar hit-testing manual, complexo |
| **HTML overlay** (divs absolutas sobre o canvas) | Mais simples, acessível, fácil de estilizar | Pode ter conflito de touch events com o canvas |

> [!WARNING]
> **Recomendação: HTML overlay.** É significativamente mais simples e o React já gerencia esses elementos naturalmente. Os botões seriam componentes React posicionados `position: fixed` sobre o canvas. Touch events nos botões chamam métodos do InputManager da engine.

---

### 🟢 Sistema de Zoom em 3 Níveis ✅

O zoom em 3 níveis adiciona valor estratégico (jogador pode "planejar rota" no zoom máximo).

**Níveis propostos:**

| Nível | Nome | Comportamento |
|---|---|---|
| 1 | **Street View** | Câmera segue o veículo, mostra ~3x3 blocos ao redor. Escala ~1.0x |
| 2 | **Neighborhood** | Câmera segue o veículo, mostra ~20% do mapa total. Escala calculada dinamicamente |
| 3 | **City Map** | Câmera fixa, mostra 100% do mapa. Veículo é um ponto pequeno |

**Mecanismo de troca:** Botão de lupa (🔍) no HUD que cicla entre os 3 níveis com tap simples: Street View → Neighborhood → City Map → Street View.

**Transição:** Animação suave de zoom (lerp na escala) ao trocar nível.

> [!NOTE]
> Pinch-to-zoom nativo do browser será desabilitado (`touch-action: none` + `preventDefault`) para evitar conflitos. O botão de lupa no HUD é o único mecanismo de zoom.

---

### 🟡 Snap Angular a 45°

O snapping de ângulos para múltiplos de 45° tem uma implicação visual importante: **as setas de direção no modo decisão sempre apontarão em uma das 8 direções cardeais/intercardeais**.

```
        N (0°)
   NW (315°)  NE (45°)
  W (270°)      E (90°)
   SW (225°)  SE (135°)
        S (180°)
```

Isso funciona perfeitamente no grid 4×4 mockado (só usa 0°, 90°, 180°, 270°). Para mapas reais, uma rua a 37° seria tratada como 45° (NE) para fins de decisão direcional.

> [!NOTE]
> O snap é apenas para a **lógica de decisão** (qual aresta é "esquerda" vs "direita"). O **rendering** da rua no mapa continua usando o ângulo real para manter fidelidade visual. Assim, a representação visual é precisa, mas a mecânica de escolha é simplificada.

---

### 🟢 Estilo Visual — Mapa Realista

Mudança completa do estilo neon para um visual de mapa urbano:

| Elemento | Visual |
|---|---|
| **Background** | Bege/creme suave (#F5F0E8) ou cinza muito claro |
| **Blocos (quarteirões)** | Retângulos preenchidos em tons pastéis variados (lavanda, menta, pêssego, amarelo pálido) — cada bloco uma cor aleatória do conjunto |
| **Ruas** | Faixa cinza escuro (#3A3A3A) representando asfalto |
| **Linha central** | Branca, tracejada (`setLineDash([8, 6])`) ao longo do centro da via |
| **Calçadas** | Bordas levemente mais claras nas laterais da rua (opcional) |
| **Nós (interseções)** | Sem marcação explícita — a interseção é apenas o cruzamento natural das ruas |
| **Veículo** | Retângulo visto de cima (~estilo van/utilitário). Corpo com cor sólida, contorno escuro, detalhe de cabine na frente |
| **Pickup point** | Ícone 📦 ou marcador visual pulsante |
| **Delivery point** | Ícone 🏠 ou marcador visual com cor diferente |
| **Setas de decisão** | Setas semi-transparentes sobre as ruas disponíveis, a selecionada com opacidade/cor mais forte |

> [!NOTE]
> As ruas precisam ter **largura visual** (não são linhas finas). No Canvas, isso significa desenhar `ctx.lineWidth = roadWidth` ou usar `fillRect` para cada segmento de rua. A largura da rua afeta diretamente como os blocos de prédios são renderizados (eles preenchem o espaço entre as ruas).

**Abordagem de renderização dos blocos:**

Como o grid é estruturado, os "blocos de prédios" são os espaços entre as ruas. Em vez de desenhar prédios individualmente, a abordagem mais eficiente é:

1. Preencher o background inteiro com a cor das calçadas
2. Desenhar os blocos (retângulos entre nós adjacentes) com cores pastéis
3. Desenhar as ruas por cima (asfalto cinza)
4. Desenhar as linhas centrais tracejadas por cima das ruas

---

## Estrutura de Diretórios Atualizada

```
src/
├── components/
│   ├── GamePage.jsx          # Canvas + overlay de controles
│   ├── HUD.jsx               # Score, timer, zoom button, status
│   ├── TouchControls.jsx     # [NOVO] Botões direcionais mobile (HTML overlay)
│   └── MainMenu.jsx          # Tela inicial
├── engine/
│   ├── MiniDeliveryGame.js   # Orquestrador principal
│   ├── GameLoop.js           # rAF loop com delta time
│   ├── Renderer.js           # Canvas 2D — mapa, veículo, indicadores
│   ├── InputManager.js       # [ALTERADO] Keyboard + Touch input unificado
│   ├── GraphManager.js       # Dados do grafo + queries
│   ├── Vehicle.js            # Estado + lógica do veículo
│   ├── Camera.js             # [ALTERADO] 3 níveis de zoom + follow
│   └── GameObjective.js      # [NOVO] Pickup/delivery logic + timer
├── data/
│   └── mockGraph.js          # 4x4 grid graph
├── styles/
│   └── game.css              # Estilos do overlay, HUD, controles touch
├── App.jsx
└── main.jsx
```

---

## Plano de Implementação Faseado (Revisado)

### Fase 1A — Setup & Dados `[~1h]`

- Criar projeto Vite + React
- Definir e configurar `viewport` meta para mobile
- Criar estrutura de diretórios
- Implementar mock graph (4×4, 16 nós, 24 arestas)
- Classe `GraphManager` com métodos de consulta

### Fase 1B — Canvas, Câmera & Renderização do Mapa `[~3h]`

- `GameLoop` com `requestAnimationFrame` + delta time
- Canvas responsivo (`resize` listener, `devicePixelRatio`)
- Sistema de `Camera` com 3 níveis de zoom:
  - Nível 1: Follow player, escala ~1.0
  - Nível 2: Follow player, escala para mostrar ~20% do mapa
  - Nível 3: Estático, mostra 100%
  - Transição animada (lerp) entre níveis
- `Renderer`:
  - Background bege/creme
  - Blocos de quarteirões em cores pastéis
  - Ruas em cinza escuro com largura visual real
  - Linhas centrais brancas tracejadas
  - Interseções como cruzamentos naturais (sem marcador)

### Fase 1C — Veículo & Movimento `[~3h]`

- Classe `Vehicle`:
  - Estado: `currentEdge`, `progress (0→1)`, `speed`, `orientation`
  - Posição inicial: nó mais próximo do centro do mapa
  - Orientação inicial: voltado para a direita (East, 0°)
- Aceleração gradual (UP), desaceleração por atrito (soltar UP)
- Ré a 50% da velocidade máxima (DOWN)
- Interpolação linear ao longo da aresta
- Chegada a nó: detecção de `progress >= 1.0`
- Passagem automática em nós de 2 conexões
- Dead-end: para, só permite ré
- Rendering do veículo:
  - Retângulo visto de cima (van/utilitário)
  - Corpo colorido + contorno escuro
  - Detalhe frontal (cabine)
  - Rotação alinhada à direção de movimento

### Fase 1D — Input System (Mobile First) `[~2h]`

- `InputManager`:
  - Interface unificada: `isAccelerating()`, `isBraking()`, `isTurningLeft()`, `isTurningRight()`
  - Backend keyboard: `keydown`/`keyup` no window (fallback desktop)
  - Backend touch: recebe comandos do `TouchControls.jsx`
- Componente React `TouchControls.jsx`:
  - **Layout definido:**
    - **Lateral direita** (vertical): botão ↑ (acelerar) em cima, botão ↓ (frear/ré) embaixo — `position: fixed; right: 16px`
    - **Parte inferior central** (horizontal): botão ← à esquerda, botão → à direita — `position: fixed; bottom: 16px`
    - Os dois grupos **não se sobrepõem** (direcionais ficam centrados no bottom, aceleração fica na borda direita com offset vertical para evitar conflito)
  - Botões como `<div>` com `position: fixed`
  - Touch events: `onTouchStart` → press, `onTouchEnd` → release
  - Visual: semi-transparentes (#00000040), bordas arredondadas, ícone de seta interno, feedback visual ao pressionar (opacidade aumenta)
  - Tamanho mínimo de toque: 56×56px (confortável para polegar)
  - `touch-action: none` no CSS para evitar comportamentos nativos

```
┌─────────────────────────────┐
│                             │
│         GAME CANVAS         │
│                        [↑]  │
│                             │
│                        [↓]  │
│                             │
│         [←]    [→]          │
└─────────────────────────────┘
```

### Fase 1E — Sistema de Decisão em Interseções `[~2h]`

- Detecção de nó com >2 conexões → estado `DECIDING`
- Desaceleração progressiva ao se aproximar do nó
- Cálculo de arestas disponíveis, excluindo a aresta de chegada
- Snap angular para múltiplos de 45° para classificação direcional
- ← → cicla entre arestas disponíveis (ordenadas por ângulo relativo)
- ↑ confirma e inicia travessia na aresta selecionada
- Visual:
  - Setas semi-transparentes nas ruas disponíveis
  - Seta selecionada com destaque (cor mais viva ou brilho)
  - Possível animação de pulse na seta selecionada

### Fase 1F — Objetivo de Jogo (Pickup/Delivery) `[~1.5h]`

- Classe `GameObjective`:
  - Gera ponto de pickup (📦) e delivery (🏠) em nós aleatórios (distância mínima entre eles)
  - Estado: `PICKUP_PHASE` → `DELIVERY_PHASE` → `COMPLETED`
  - Timer contando tempo desde início
- Lógica:
  - Veículo chega ao nó do pickup → coleta automática, transição para delivery phase
  - Veículo chega ao nó do delivery → entrega, mostra tempo final
  - Após completar: gera novo par pickup/delivery
- Visual:
  - Marcadores pulsantes nos nós objetivo
  - Indicador no HUD do objetivo atual
  - Feedback visual na coleta/entrega

### Fase 1G — HUD & Integração Final `[~1.5h]`

- Componente `HUD.jsx`:
  - Timer (tempo corrido)
  - Entregas completadas (score)
  - Botão de zoom (cicla entre os 3 níveis)
  - Indicador de objetivo ("Colete o pacote!" / "Entregue!")
  - Status do veículo (velocidade como barra visual)
- Componente `MainMenu.jsx`:
  - Tela de início simples com botão "Jogar"
  - Breve instrução dos controles
- `GamePage.jsx`:
  - Orquestra canvas + HUD + TouchControls
  - Gerencia lifecycle do `MiniDeliveryGame`
  - Callback pattern para state updates

### Fase 1H — Polish `[~1h]`

- Animação suave de zoom entre níveis
- Feedback haptico nos botões touch (se disponível via `navigator.vibrate`)
- Rastro sutil do veículo (últimas N posições com fade)
- Som básico: bip ao coletar/entregar (opcional, Web Audio API)
- Teste em dispositivos móveis reais / DevTools mobile emulation
- Ajuste de DPI e performance

---

## Estimativa Revisada

| Fase | Descrição | Tempo |
|---|---|---|
| 1A | Setup & Dados | ~1h |
| 1B | Canvas, Câmera & Mapa | ~3h |
| 1C | Veículo & Movimento | ~3h |
| 1D | Input Mobile First | ~2h |
| 1E | Decisão em Interseções | ~2h |
| 1F | Pickup/Delivery | ~1.5h |
| 1G | HUD & Integração | ~1.5h |
| 1H | Polish | ~1h |
| **Total** | | **~15h** |

> [!NOTE]
> O tempo aumentou de ~10h para ~15h principalmente devido a: (1) mobile-first com controles touch, (2) sistema de 3 níveis de zoom, (3) lógica de pickup/delivery, e (4) renderização de mapa realista (blocos, asfalto, linhas tracejadas).

---

## ✅ Todas as Decisões Consolidadas

Não há questões pendentes. O plano está pronto para aprovação e início da implementação.

> [!TIP]
> Após aprovação, o próximo passo é criar o projeto Vite + React e iniciar pela **Fase 1A**.
