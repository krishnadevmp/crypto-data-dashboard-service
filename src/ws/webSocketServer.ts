/**
 * websocketServer.ts
 *
 * WebSocket endpoint: ws://localhost:3001
 *
 * Subscription protocol:
 *   Client sends:  { type: "subscribe",   pair: "BTC-USDT", stream: "all" | "candles" | "orderbook" }
 *   Client sends:  { type: "unsubscribe", pair: "BTC-USDT", stream: "all" | "candles" | "orderbook" }
 *
 * Server pushes every 10 s:
 *   { type: "candle_update",    pair, candle }   — single latest candle
 *   { type: "orderbook_update", pair, data }     — full order book snapshot
 *   { type: "error",            message }        — on bad subscription messages
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import {
  isCryptoPair,
  VALID_PAIRS,
  type CryptoPair,
  type Candle,
  type OrderBook,
} from "../types/apiTypes";
import { onTick, getMockOrderBook } from "../data/mockData";

// ---------------------------------------------------------------------------
// Outbound message types
// ---------------------------------------------------------------------------

interface CandleUpdateMessage {
  type: "candle_update";
  pair: CryptoPair;
  candle: Candle;
}

interface OrderBookUpdateMessage {
  type: "orderbook_update";
  pair: CryptoPair;
  data: OrderBook;
}

interface ErrorMessage {
  type: "error";
  message: string;
}

type OutboundMessage =
  | CandleUpdateMessage
  | OrderBookUpdateMessage
  | ErrorMessage;

// ---------------------------------------------------------------------------
// Inbound message type
// ---------------------------------------------------------------------------

type StreamMode = "all" | "candles" | "orderbook";

interface SubscribeMessage {
  type: "subscribe" | "unsubscribe";
  pair: CryptoPair;
  stream: StreamMode;
}

// ---------------------------------------------------------------------------
// Subscription tracking
// ---------------------------------------------------------------------------

type SubscriptionKey = `${CryptoPair}:${StreamMode}`;

function makeKey(pair: CryptoPair, stream: StreamMode): SubscriptionKey {
  return `${pair}:${stream}`;
}

function wantsCandles(subs: Set<SubscriptionKey>, pair: CryptoPair): boolean {
  return subs.has(makeKey(pair, "candles")) || subs.has(makeKey(pair, "all"));
}

function wantsOrderBook(subs: Set<SubscriptionKey>, pair: CryptoPair): boolean {
  return subs.has(makeKey(pair, "orderbook")) || subs.has(makeKey(pair, "all"));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(ws: WebSocket, msg: OutboundMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendError(ws: WebSocket, message: string): void {
  send(ws, { type: "error", message });
}

function parseMessage(raw: string): SubscribeMessage | null {
  try {
    const msg = JSON.parse(raw) as unknown;
    if (
      typeof msg !== "object" ||
      msg === null ||
      !("type" in msg) ||
      !("pair" in msg) ||
      !("stream" in msg)
    )
      return null;

    const { type, pair, stream } = msg as Record<string, unknown>;

    if (type !== "subscribe" && type !== "unsubscribe") return null;
    if (typeof pair !== "string" || !isCryptoPair(pair)) return null;
    if (stream !== "all" && stream !== "candles" && stream !== "orderbook")
      return null;

    return { type, pair, stream } as SubscribeMessage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

export function createWebSocketServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer });
  const clients = new Map<WebSocket, Set<SubscriptionKey>>();

  // On every 10-second tick: push the single updated candle + fresh order book
  onTick((pair, candle) => {
    for (const [ws, subs] of clients) {
      if (wantsCandles(subs, pair)) {
        send(ws, { type: "candle_update", pair, candle });
      }
      if (wantsOrderBook(subs, pair)) {
        send(ws, {
          type: "orderbook_update",
          pair,
          data: getMockOrderBook(pair),
        });
      }
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    clients.set(ws, new Set());
    console.log(`[ws] client connected  — total: ${clients.size}`);

    ws.on("message", (raw: Buffer) => {
      const msg = parseMessage(raw.toString());

      if (!msg) {
        sendError(
          ws,
          `Invalid message. Expected: { type: "subscribe" | "unsubscribe", pair: "${VALID_PAIRS.join('" | "')}", stream: "all" | "candles" | "orderbook" }`,
        );
        return;
      }

      const subs = clients.get(ws)!;
      const key = makeKey(msg.pair, msg.stream);

      if (msg.type === "subscribe") {
        subs.add(key);
        console.log(`[ws] subscribe   ${key}`);
      } else {
        subs.delete(key);
        console.log(`[ws] unsubscribe ${key}`);
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      console.log(`[ws] client disconnected — total: ${clients.size}`);
    });

    ws.on("error", (err) => {
      console.error("[ws] client error:", err.message);
      clients.delete(ws);
    });
  });

  return wss;
}
