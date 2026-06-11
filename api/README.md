# Mini Delivery — Map API

Backend Python (Fase 2) do jogo **Mini Delivery**.  
Gera mapas reais do OpenStreetMap e retorna um JSON de grafo normalizado em pixels, consumido pelo `GraphManager.js` do frontend.

---

## Pré-requisitos

- Python 3.10+
- pip

---

## Setup

```bash
# Entre na pasta da API
cd api/

# (Recomendado) Crie um ambiente virtual
python -m venv .venv
source .venv/bin/activate        # Linux/macOS
# .venv\Scripts\activate         # Windows

# Instale as dependências
pip install -r requirements.txt
```

> **Nota:** O `osmnx` instala `geopandas`, `shapely`, `networkx` e outras dependências pesadas. O primeiro `pip install` pode demorar alguns minutos.

---

## Executar o servidor

```bash
uvicorn main:app --reload
```

O servidor sobe em `http://localhost:8000`.

---

## Uso

### Gerar mapa — Rio de Janeiro (Centro)

```bash
curl -X POST http://localhost:8000/generate-map \
  -H "Content-Type: application/json" \
  -d '{"lat": -22.9068, "lng": -43.1729}'
```

### Gerar mapa — São Paulo (Paulista)

```bash
curl -X POST http://localhost:8000/generate-map \
  -H "Content-Type: application/json" \
  -d '{"lat": -23.5614, "lng": -46.6560}'
```

### Verificar status e cache

```bash
curl http://localhost:8000/health
```

### Documentação interativa (Swagger UI)

Abra no browser: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## Estrutura de arquivos

```
api/
├── main.py          ← FastAPI server, endpoint POST /generate-map, cache, CORS
├── map_builder.py   ← Pipeline OSMnx: download, simplificação, normalização, shops
├── requirements.txt ← Dependências Python
└── README.md        ← Este arquivo
```

---

## Formato da resposta

```json
{
  "nodes": {
    "node_0": { "id": "node_0", "x": 487.3, "y": 512.1, "connections": ["node_1", "node_5"] }
  },
  "edges": [
    {
      "id": "node_0__node_1",
      "from": "node_0",
      "to": "node_1",
      "length": 37.1,
      "geometry": [{"x": 487.3, "y": 512.1}, {"x": 523.8, "y": 510.4}]
    }
  ],
  "shops": [
    { "id": "shop_0", "name": "Padaria Central", "x": 524.1, "y": 511.8, "snap_node": "node_1" }
  ],
  "meta": {
    "center_lat": -22.9068,
    "center_lng": -43.1729,
    "canvas_size": 1000
  }
}
```

Todas as coordenadas estão normalizadas no espaço `[0, 1000]` pixels, com o centro geográfico em `(500, 500)`.

---

## Comportamento

| Situação | Resposta |
|---|---|
| Primeira chamada para uma localização | 5–15 s (download OSM) |
| Chamadas subsequentes para ±0.001° (~111m) | < 1 s (cache em memória) |
| Coordenadas no oceano / sem dados OSM | HTTP 422 com mensagem descritiva |
| Coordenadas inválidas (lat > 90, etc.) | HTTP 422 automático (validação Pydantic) |
| Erro interno inesperado | HTTP 500 com detalhe no log |
| Mais de 300 nós após simplificação | Warning no log, resposta normal |
| Nenhum shop real na área | 4–8 shops sintéticos gerados automaticamente |

---

## Variáveis configuráveis em `map_builder.py`

| Constante | Valor padrão | Descrição |
|---|---|---|
| `GRAPH_RADIUS_M` | `565` | Raio do download em metros (~1 km² de área) |
| `MAX_SHOPS` | `15` | Limite máximo de shops no JSON |
| `MIN_SYNTHETIC_SHOPS` | `4` | Mínimo de shops sintéticos gerados |
| `MAX_SYNTHETIC_SHOPS` | `8` | Máximo de shops sintéticos gerados |
| `CANVAS_SIZE` | `1000` | Tamanho do espaço de pixels |
| `CANVAS_PADDING` | `50` | Margem interna (nós ficam dentro de [50, 950]) |
| `NODE_LIMIT_WARN` | `300` | Aviso de log se grafo tiver mais nós |
