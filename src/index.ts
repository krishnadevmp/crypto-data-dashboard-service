import express, { Request, Response } from "express";

const app = express();
const PORT = 3001;

app.use(express.json());

app.get("/api/candles/:pair", (req: Request, res: Response) => {
  const { pair } = req.params;
  res.json({ message: `Candles for ${pair}` });
});

app.get("/api/orderbook/:pair", (req: Request, res: Response) => {
  const { pair } = req.params;
  res.json({ message: `Order book for ${pair}` });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
