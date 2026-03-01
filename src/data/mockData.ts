/**
 * mockData.ts
 *
 * Mock data store with a real-time simulation layer.
 *
 * Architecture:
 *  - 59 historical candles are generated once at startup and never change.
 *  - The 60th candle is the "live" candle — its close, high, low, and volume
 *    tick forward every 10 seconds via a price walk, simulating a real exchange
 *    where only the current open candle mutates until a new one opens.
 *  - Order books are regenerated on every request, centred on the live price.
 *
 * This mirrors real exchange behaviour exactly:
 *   - Historical candles: immutable
 *   - Current candle: updates in place until the hour rolls over
 *   - Order book: always fresh, always anchored to current price
 */

import type {
  Candle,
  CryptoPair,
  OrderBook,
  OrderBookEntry,
} from "../types/apiTypes";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface PairConfig {
  basePrice: number;
  volatility: number;
  spread: number;
  decimals: number;
  /** Tick volatility — smaller than candle volatility for smooth intra-candle moves */
  tickVolatility: number;
}

const PAIR_CONFIG: Record<CryptoPair, PairConfig> = {
  "BTC-USDT": {
    basePrice: 67_500,
    volatility: 0.018,
    spread: 8,
    decimals: 2,
    tickVolatility: 0.0008,
  },
  "ETH-USDT": {
    basePrice: 3_480,
    volatility: 0.022,
    spread: 0.5,
    decimals: 2,
    tickVolatility: 0.001,
  },
  "XRP-USDT": {
    basePrice: 0.615,
    volatility: 0.028,
    spread: 0.0003,
    decimals: 4,
    tickVolatility: 0.0012,
  },
};

const CANDLE_COUNT = 60;
const HOUR_MS = 3_600_000;
const TICK_INTERVAL = 10_000; // 10 seconds

// ---------------------------------------------------------------------------
// Seeded RNG (LCG)
// ---------------------------------------------------------------------------

function createSeededRng(seed: number): () => number {
  let s = seed;
  return function next(): number {
    s = (s * 1_664_525 + 1_013_904_223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function pairSeed(pair: CryptoPair): number {
  return pair.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Historical candle generator (59 completed candles)
// ---------------------------------------------------------------------------

/**
 * Generates CANDLE_COUNT - 1 completed historical candles.
 * These are immutable — they represent closed hourly bars.
 * Returns the candles AND the last closing price so the live candle
 * can open at exactly that price.
 */
function buildHistoricalCandles(pair: CryptoPair): {
  candles: Candle[];
  lastClose: number;
} {
  const cfg = PAIR_CONFIG[pair];
  const rng = createSeededRng(pairSeed(pair));
  const candles: Candle[] = [];

  const now = Date.now();
  const currentHour = now - (now % HOUR_MS);
  // Historical candles occupy the 59 hours BEFORE the current hour
  const startTime = currentHour - (CANDLE_COUNT - 1) * HOUR_MS;

  let price = cfg.basePrice;

  for (let i = 0; i < CANDLE_COUNT - 1; i++) {
    const time = startTime + i * HOUR_MS;
    const open = round(price, cfg.decimals);
    const rangePct = rng() * cfg.volatility;
    const direction = rng() > 0.48 ? 1 : -1;
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

  return { candles, lastClose: price };
}

// ---------------------------------------------------------------------------
// Live candle state — one per pair
// ---------------------------------------------------------------------------

interface LiveCandleState {
  /** The candle object that gets mutated on each tick */
  candle: Candle;
  /** Tracks the current live price between ticks */
  currentPrice: number;
  /** Seeded RNG instance kept alive between ticks for continuity */
  rng: () => number;
  /** Config reference */
  cfg: PairConfig;
}

const liveState: Record<CryptoPair, LiveCandleState> = {} as Record<
  CryptoPair,
  LiveCandleState
>;

/**
 * Initialises the live candle for a pair based on the last historical close.
 * The live candle opens at the current hour with open = lastClose.
 */
function initLiveCandle(pair: CryptoPair, lastClose: number): void {
  const cfg = PAIR_CONFIG[pair];
  const now = Date.now();
  const currentHour = now - (now % HOUR_MS);

  liveState[pair] = {
    candle: {
      time: currentHour,
      open: lastClose,
      high: lastClose,
      low: lastClose,
      close: lastClose,
      volume: 0,
    },
    currentPrice: lastClose,
    rng: createSeededRng(pairSeed(pair) + Date.now()), // non-deterministic seed for live ticks
    cfg,
  };
}

/**
 * Advances the live candle by one tick.
 *
 * On each tick:
 *  - Price moves by a small random amount (tickVolatility, much smaller than hourly volatility)
 *  - High/low are updated if the new price exceeds them
 *  - Volume accumulates
 *  - Close is updated to the new price
 *
 * If the current hour has rolled over, a new live candle is opened.
 */
function tickLiveCandle(pair: CryptoPair): void {
  const state = liveState[pair];
  const now = Date.now();
  const currentHour = now - (now % HOUR_MS);

  // Hour rolled over — open a new live candle
  if (currentHour > state.candle.time) {
    initLiveCandle(pair, state.currentPrice);
    return;
  }

  const { cfg, rng } = state;

  // Small random price move — slight bullish bias (0.48 threshold)
  const move = state.currentPrice * cfg.tickVolatility * (rng() - 0.48);
  const newPrice = round(state.currentPrice + move, cfg.decimals);

  state.currentPrice = newPrice;
  state.candle.close = newPrice;
  state.candle.high = round(
    Math.max(state.candle.high, newPrice),
    cfg.decimals,
  );
  state.candle.low = round(Math.min(state.candle.low, newPrice), cfg.decimals);

  // Small volume increment per tick
  const baseVolume =
    pair === "BTC-USDT" ? 120 : pair === "ETH-USDT" ? 1_800 : 250_000;
  state.candle.volume = round(
    state.candle.volume + (baseVolume / 360) * (0.5 + rng()),
    2,
  );
}

// ---------------------------------------------------------------------------
// In-memory data store
// ---------------------------------------------------------------------------

/**
 * The full candle array served by GET /api/candles/:pair.
 * Index 0–58: historical (immutable).
 * Index 59:   live candle (mutated by the ticker).
 */
export const MOCK_CANDLES: Record<CryptoPair, Candle[]> = {} as Record<
  CryptoPair,
  Candle[]
>;

// Build initial state for each pair
for (const pair of ["BTC-USDT", "ETH-USDT", "XRP-USDT"] as CryptoPair[]) {
  const { candles, lastClose } = buildHistoricalCandles(pair);
  initLiveCandle(pair, lastClose);
  // Push a reference to the live candle object — mutations are reflected automatically
  MOCK_CANDLES[pair] = [...candles, liveState[pair].candle];
}

// ---------------------------------------------------------------------------
// Ticker — advances all three live candles every 10 seconds
// ---------------------------------------------------------------------------

/**
 * Callbacks registered by the WebSocket server.
 * Called after every tick with the updated candle for each pair.
 */
type TickCallback = (pair: CryptoPair, candle: Candle) => void;
const tickCallbacks: TickCallback[] = [];

/** Register a function to be called after every tick. */
export function onTick(cb: TickCallback): void {
  tickCallbacks.push(cb);
}

setInterval(() => {
  for (const pair of ["BTC-USDT", "ETH-USDT", "XRP-USDT"] as CryptoPair[]) {
    tickLiveCandle(pair);
    // Notify all registered listeners with a snapshot of the updated candle
    const snapshot = { ...liveState[pair].candle };
    tickCallbacks.forEach((cb) => cb(pair, snapshot));
  }
  console.log(
    `[tick] BTC: ${liveState["BTC-USDT"].candle.close}`,
    `| ETH: ${liveState["ETH-USDT"].candle.close}`,
    `| XRP: ${liveState["XRP-USDT"].candle.close}`,
  );
}, TICK_INTERVAL);

// ---------------------------------------------------------------------------
// Order book generator — regenerated per request, anchored to live price
// ---------------------------------------------------------------------------

/**
 * Generates a fresh order book snapshot centred on the current live price.
 * Called on every GET /api/orderbook/:pair request so it always reflects
 * the latest tick.
 */
export function getMockOrderBook(pair: CryptoPair): OrderBook {
  const cfg = PAIR_CONFIG[pair];
  // Use a fresh non-seeded RNG so order book amounts vary each call
  const rng = () => Math.random();
  const midPrice = liveState[pair].currentPrice;

  const LEVELS = 15;
  const asks: OrderBookEntry[] = [];
  const bids: OrderBookEntry[] = [];

  for (let i = 1; i <= LEVELS; i++) {
    const jitter = rng() * cfg.spread * 0.3;
    const askPrice = round(midPrice + cfg.spread * i + jitter, cfg.decimals);
    const bidPrice = round(midPrice - cfg.spread * i - jitter, cfg.decimals);
    const baseAmount =
      pair === "BTC-USDT" ? 0.5 : pair === "ETH-USDT" ? 4 : 12_000;
    const amount = round(
      (baseAmount * (1 + rng() * 2) * (LEVELS - i + 1)) / LEVELS,
      4,
    );
    asks.push([askPrice, amount]);
    bids.push([bidPrice, amount]);
  }

  asks.sort((a, b) => a[0] - b[0]);
  bids.sort((a, b) => b[0] - a[0]);

  return { pair, asks, bids, timestamp: Date.now() };
}
