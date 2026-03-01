/**
 * mockData.ts
 *
 * Deterministic mock data generators for all three trading pairs.
 *
 * The generation logic is identical to the frontend's generateMockData.ts so
 * both the client-side mock mode and this server return the same numbers —
 * making it easy to switch between them without visible data changes.
 *
 * "Deterministic" means the same pair always produces the same sequence of
 * candles. This is achieved with a seeded pseudo-random number generator (LCG)
 * instead of Math.random(), so there are no surprises between server restarts.
 */

import type {
  Candle,
  CryptoPair,
  OrderBook,
  OrderBookEntry,
} from "../types/apiTypes";

// ---------------------------------------------------------------------------
// Per-pair configuration
// ---------------------------------------------------------------------------

interface PairConfig {
  /** Starting price for the random walk. */
  basePrice: number;
  /** Max ± percentage move per hourly candle. */
  volatility: number;
  /** Typical dollar spread between best bid and best ask. */
  spread: number;
  /** Decimal places used when rounding prices and amounts. */
  decimals: number;
}

const PAIR_CONFIG: Record<CryptoPair, PairConfig> = {
  "BTC-USDT": { basePrice: 67_500, volatility: 0.018, spread: 8, decimals: 2 },
  "ETH-USDT": { basePrice: 3_480, volatility: 0.022, spread: 0.5, decimals: 2 },
  "XRP-USDT": {
    basePrice: 0.615,
    volatility: 0.028,
    spread: 0.0003,
    decimals: 4,
  },
};

const CANDLE_COUNT = 60;
const HOUR_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Seeded pseudo-random number generator (LCG)
// ---------------------------------------------------------------------------

/**
 * Creates a deterministic RNG seeded with the given number.
 * Returns values in [0, 1) — same interface as Math.random().
 * Using LCG constants from Numerical Recipes.
 */
function createSeededRng(seed: number): () => number {
  let s = seed;
  return function next(): number {
    s = (s * 1_664_525 + 1_013_904_223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

/** Derives a stable numeric seed from a pair string. */
function pairSeed(pair: CryptoPair): number {
  return pair.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Candle generator
// ---------------------------------------------------------------------------

/**
 * Generates 60 hourly OHLCV candles for the given pair.
 *
 * Candles end at the current hour so they always appear recent in the chart.
 * The random walk is seeded by the pair name, so the same pair always
 * produces the same price sequence regardless of when the server runs.
 */
export function getMockCandles(pair: CryptoPair): Candle[] {
  const cfg = PAIR_CONFIG[pair];
  const rng = createSeededRng(pairSeed(pair));
  const candles: Candle[] = [];

  // Align to the top of the current hour
  const now = Date.now();
  const currentHour = now - (now % HOUR_MS);
  const startTime = currentHour - (CANDLE_COUNT - 1) * HOUR_MS;

  let price = cfg.basePrice;

  for (let i = 0; i < CANDLE_COUNT; i++) {
    const time = startTime + i * HOUR_MS;

    const open = round(price, cfg.decimals);
    const rangePct = rng() * cfg.volatility;
    const direction = rng() > 0.48 ? 1 : -1; // slight bullish bias
    const close = round(open * (1 + direction * rangePct), cfg.decimals);

    const wickExtra = rng() * cfg.volatility * 0.5;
    const high = round(Math.max(open, close) * (1 + wickExtra), cfg.decimals);
    const low = round(Math.min(open, close) * (1 - wickExtra), cfg.decimals);

    const baseVolume =
      pair === "BTC-USDT" ? 120 : pair === "ETH-USDT" ? 1_800 : 250_000;
    const volume = round(baseVolume * (0.5 + rng()) * (1 + rangePct * 10), 2);

    candles.push({ time, open, high, low, close, volume });
    price = close;
  }

  return candles;
}

// ---------------------------------------------------------------------------
// Order book generator
// ---------------------------------------------------------------------------

/**
 * Generates a realistic order book snapshot for the given pair.
 *
 * Produces 15 ask levels (ascending price) and 15 bid levels (descending
 * price), centred on the last close of the generated candles.
 * The spread and liquidity distribution match each pair's real-world profile.
 */
export function getMockOrderBook(pair: CryptoPair): OrderBook {
  const cfg = PAIR_CONFIG[pair];
  const rng = createSeededRng(pairSeed(pair) + 99); // offset seed from candles
  const candles = getMockCandles(pair);
  const midPrice = candles[candles.length - 1].close;

  const LEVELS = 15;
  const asks: OrderBookEntry[] = [];
  const bids: OrderBookEntry[] = [];

  for (let i = 1; i <= LEVELS; i++) {
    const jitter = rng() * cfg.spread * 0.3;
    const askPrice = round(midPrice + cfg.spread * i + jitter, cfg.decimals);
    const bidPrice = round(midPrice - cfg.spread * i - jitter, cfg.decimals);

    // Liquidity clusters near the mid — deeper levels have smaller amounts
    const baseAmount =
      pair === "BTC-USDT" ? 0.5 : pair === "ETH-USDT" ? 4 : 12_000;
    const amount = round(
      (baseAmount * (1 + rng() * 2) * (LEVELS - i + 1)) / LEVELS,
      4,
    );

    asks.push([askPrice, amount]);
    bids.push([bidPrice, amount]);
  }

  asks.sort((a, b) => a[0] - b[0]); // ascending — cheapest sell first
  bids.sort((a, b) => b[0] - a[0]); // descending — highest buy first

  return {
    pair,
    asks,
    bids,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Pre-built data store — generated once on server start
// ---------------------------------------------------------------------------

/**
 * A typed Record keyed by CryptoPair holding pre-generated data.
 * Candles are generated once at startup (timestamps stay current for the
 * session). Order books are regenerated per request so the timestamp
 * is always fresh — see the route handlers.
 */
export const MOCK_CANDLES: Record<CryptoPair, Candle[]> = {
  "BTC-USDT": getMockCandles("BTC-USDT"),
  "ETH-USDT": getMockCandles("ETH-USDT"),
  "XRP-USDT": getMockCandles("XRP-USDT"),
};
