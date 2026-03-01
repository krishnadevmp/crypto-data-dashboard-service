import express from "express";
import cors from "cors";

import candlesRouter from "./routes/candles";
import orderbookRouter from "./routes/orderbook";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(express.json());

// Allow requests from the Vite dev server
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  }),
);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.use("/api/candles", candlesRouter);
app.use("/api/orderbook", orderbookRouter);

// Health check — useful to verify the server is up
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Crypto mock server running at http://localhost:${PORT}`);
  console.log(`  GET /api/candles/:pair   — BTC-USDT | ETH-USDT | XRP-USDT`);
  console.log(`  GET /api/orderbook/:pair — BTC-USDT | ETH-USDT | XRP-USDT`);
  console.log(`  GET /health`);
});
