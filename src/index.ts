import express from "express";
import cors from "cors";
import http from "http";

import candlesRouter from "./routes/candles";
import orderbookRouter from "./routes/orderbook";
import { createWebSocketServer } from "./ws/webSocketServer";

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
// HTTP server — shared between Express and WebSocket
//
// Express alone cannot share a port with a WebSocket server.
// The solution: create a plain Node http.Server, hand the Express app to it
// as the request handler, then attach the ws WebSocketServer to the same
// http.Server instance. Both live on PORT 3001.
//
//   HTTP request → Express handles (REST routes)
//   WS upgrade   → ws library intercepts the upgrade event
// ---------------------------------------------------------------------------

const httpServer = http.createServer(app);

createWebSocketServer(httpServer);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

httpServer.listen(PORT, () => {
  console.log(`\nCrypto mock server running on port ${PORT}`);
  console.log(`  REST:`);
  console.log(`    GET  http://localhost:${PORT}/api/candles/:pair`);
  console.log(`    GET  http://localhost:${PORT}/api/orderbook/:pair`);
  console.log(`    GET  http://localhost:${PORT}/health`);
  console.log(`  WebSocket:`);
  console.log(`    ws://localhost:${PORT}`);
  console.log(`\n  Pairs:          BTC-USDT | ETH-USDT | XRP-USDT`);
  console.log(`  Tick interval:  10 seconds\n`);
});
