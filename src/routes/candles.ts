import { Router, Request, Response } from "express";
import { CryptoPair, isCryptoPair, VALID_PAIRS } from "../types/apiTypes";
import { MOCK_CANDLES } from "../data/mockData";

const router = Router();

/**
 * GET /api/candles/:pair
 *
 * Returns 60 hourly OHLCV candles for the requested trading pair.
 * Data is pre-generated at server start and served from memory.
 *
 * 200 — array of Candle objects
 * 400 — unrecognised pair
 */
router.get("/:pair", (req: Request, res: Response) => {
  const { pair } = req.params;
  const cryptoPair = pair as CryptoPair;
  if (!isCryptoPair(cryptoPair)) {
    res.status(400).json({
      error: `Unknown pair "${pair}". Valid pairs: ${VALID_PAIRS.join(", ")}`,
    });
    return;
  }

  res.json(MOCK_CANDLES[cryptoPair]);
});

export default router;
