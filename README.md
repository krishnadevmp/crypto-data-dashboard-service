# Crypto Data Dashboard Service
# Crypto Mock Server

A local mock backend for the Crypto Data Dashboard. Built with Node.js, Express, and TypeScript — no external data source or API keys required. Serves deterministic historical candle data and simulated real-time price updates over both REST and WebSocket.

---

## What It Does

The server simulates a cryptocurrency exchange backend with two responsibilities:

**Historical data (REST)** — on startup, 59 hourly OHLCV candles are generated for each trading pair using a seeded pseudo-random walk. Because the seed is derived from the pair name, the same pair always produces the same price history regardless of when the server starts. These candles are held in memory and served instantly on every request.

**Real-time simulation (WebSocket + ticker)** — a 60th "live" candle is opened at the current hour and its close, high, low, and volume are advanced by a small random tick every 10 seconds. The order book is regenerated from scratch on each tick, anchored to the current live price. Any WebSocket client subscribed to a pair receives these updates automatically.

---

## Prerequisites

- Node.js 18+
- npm 9+

---

## Getting Started

```bash
npm install
npm run dev
```

The server starts at `http://localhost:3001`. Nodemon watches `src/` and restarts on file changes.

### Build for production

```bash
npm run build
npm start
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the server listens on |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed origin for REST requests |

---

## REST API

### `GET /api/candles/:pair`

Returns an array of 60 hourly OHLCV candles. The first 59 are fixed historical candles. The 60th is the current live candle whose values change every 10 seconds.

**Supported pairs:** `BTC-USDT` · `ETH-USDT` · `XRP-USDT`

```bash
curl http://localhost:3001/api/candles/BTC-USDT
```

```json
[
  {
    "time": 1735477200000,
    "open": 67500,
    "high": 67694.25,
    "low": 66746.50,
    "close": 66939.13,
    "volume": 92.46
  }
]
```

### `GET /api/orderbook/:pair`

Returns a fresh order book snapshot with 15 ask levels (ascending) and 15 bid levels (descending), centred on the current live price.

```bash
curl http://localhost:3001/api/orderbook/BTC-USDT
```

```json
{
  "pair": "BTC-USDT",
  "asks": [[64291.26, 0.5478], [64298.31, 1.2843]],
  "bids": [[64272.86, 0.5478], [64265.81, 1.2843]],
  "timestamp": 1735689600000
}
```

### `GET /health`

```json
{ "status": "ok", "timestamp": 1735689600000 }
```

---

## WebSocket

Both the REST API and the WebSocket share the same port (`3001`). A plain Node.js `http.Server` is created first, Express is attached as the HTTP request handler, and the `ws` library attaches to the same server by intercepting the HTTP upgrade event. HTTP requests go to Express; WebSocket handshakes go to `ws`.

### Connecting

```js
const ws = new WebSocket('ws://localhost:3001');
```

### Subscribing

After the connection opens, the client must send a subscribe message to start receiving updates. The server does not push anything until a subscription is active.

```json
{
  "type": "subscribe",
  "pair": "BTC-USDT",
  "stream": "all"
}
```

| Field | Values |
|---|---|
| `type` | `"subscribe"` \| `"unsubscribe"` |
| `pair` | `"BTC-USDT"` \| `"ETH-USDT"` \| `"XRP-USDT"` |
| `stream` | `"all"` \| `"candles"` \| `"orderbook"` |

Subscribing to `"all"` is equivalent to subscribing to both `"candles"` and `"orderbook"` at once. Multiple independent subscriptions can be active at the same time — for example a client can subscribe to `BTC-USDT:candles` and `ETH-USDT:orderbook` simultaneously.

### Unsubscribing

Send the same message shape with `type: "unsubscribe"`:

```json
{
  "type": "unsubscribe",
  "pair": "BTC-USDT",
  "stream": "all"
}
```

The server removes the subscription immediately. No further messages are pushed for that pair/stream combination until the client re-subscribes.

### How messages are pushed

The internal ticker fires every 10 seconds and advances the live candle for all three pairs. After each tick, the server iterates over every connected client and checks their active subscriptions:

- If the client is subscribed to `candles` or `all` for that pair → a `candle_update` message is sent containing the single updated candle.
- If the client is subscribed to `orderbook` or `all` for that pair → an `orderbook_update` message is sent containing a freshly generated full order book snapshot.

No message is sent to clients that have not subscribed to the relevant pair and stream.

### Incoming message types

#### `candle_update`

Sent every 10 seconds per subscribed pair. Contains only the current live (open) candle — not the full history. The client is expected to splice this into its existing candle array by matching on `time`.

```json
{
  "type": "candle_update",
  "pair": "BTC-USDT",
  "candle": {
    "time": 1735689600000,
    "open": 67500.00,
    "high": 67521.40,
    "low": 67488.10,
    "close": 67504.80,
    "volume": 14.32
  }
}
```

#### `orderbook_update`

Sent every 10 seconds per subscribed pair. Contains a full order book snapshot anchored to the current live price.

```json
{
  "type": "orderbook_update",
  "pair": "BTC-USDT",
  "data": {
    "pair": "BTC-USDT",
    "asks": [[67512.40, 0.5478], [67520.71, 1.2843]],
    "bids": [[67491.20, 0.5478], [67483.49, 1.2843]],
    "timestamp": 1735689610000
  }
}
```

#### `error`

Sent when the client sends a malformed or unrecognised subscription message.

```json
{
  "type": "error",
  "message": "Invalid message. Expected: { type: \"subscribe\" | \"unsubscribe\", pair: \"BTC-USDT\" | \"ETH-USDT\" | \"XRP-USDT\", stream: \"all\" | \"candles\" | \"orderbook\" }"
}
```

### Quick test in a browser console

```js
const ws = new WebSocket('ws://localhost:3001');

ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'subscribe', pair: 'BTC-USDT', stream: 'all' }));
};

ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

Every 10 seconds a `candle_update` and an `orderbook_update` will appear in the console.

---

## Project Structure

```
src/
├── index.ts              ← creates HTTP server, attaches Express + WebSocket
├── routes/
│   ├── candles.ts        ← GET /api/candles/:pair
│   └── orderbook.ts      ← GET /api/orderbook/:pair
├── ws/
│   └── websocketServer.ts ← subscription management, tick listener, message dispatch
├── data/
│   └── mockData.ts       ← candle/orderbook generators, 10 s ticker, onTick hook
└── types/
    └── apiTypes.ts      ← CryptoPair, Candle, OrderBook (identical to frontend types)
```