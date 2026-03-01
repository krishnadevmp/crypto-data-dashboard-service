/**
 * api.types.ts
 *
 * Shared domain types for the crypto mock server.
 * These are intentionally identical to the frontend's src/types/api.types.ts
 * so both ends speak the same contract — no translation layer needed.
 *
 * If the shape of a Candle or OrderBook ever changes, update both files
 * together (or extract into a shared package if the monorepo grows).
 */

/** Supported cryptocurrency trading pairs. */
export type CryptoPair = "BTC-USDT" | "ETH-USDT" | "XRP-USDT";

/** All valid pair strings as a runtime array for route validation. */
export const VALID_PAIRS: CryptoPair[] = ["BTC-USDT", "ETH-USDT", "XRP-USDT"];

/** Type guard — narrows an arbitrary string to CryptoPair. */
export function isCryptoPair(value: string): value is CryptoPair {
  return VALID_PAIRS.includes(value as CryptoPair);
}

/**
 * A single OHLCV candlestick data point.
 * `time` is a Unix timestamp in milliseconds.
 */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * A single order book entry: [price, amount].
 * Stored as a tuple for compact JSON serialisation.
 */
export type OrderBookEntry = [number, number];

/** A full order book snapshot for one trading pair. */
export interface OrderBook {
  pair: CryptoPair;
  /** Sell orders — sorted ascending by price (cheapest first). */
  asks: OrderBookEntry[];
  /** Buy orders — sorted descending by price (highest first). */
  bids: OrderBookEntry[];
  /** Unix timestamp (ms) when this snapshot was generated. */
  timestamp: number;
}
