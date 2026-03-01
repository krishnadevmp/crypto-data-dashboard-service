import { Router, Request, Response } from "express";
import { isCryptoPair, VALID_PAIRS } from "../types/apiTypes";
import { getMockOrderBook } from "../data/mockData";
import { CryptoPair } from "../types/apiTypes";

const router = Router();

/**
 * GET /api/orderbook/:pair
 *
 * Returns a fresh order book snapshot for the requested trading pair.
 * Generated on every request (not cached) so the timestamp is always
 * current — matching how a real order book endpoint would behave.
 *
 * 200 — OrderBook object with asks, bids, and timestamp
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

  res.json(getMockOrderBook(cryptoPair));
});

export default router;
