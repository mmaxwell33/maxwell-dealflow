-- Migration 059: tag commissions with the side of the deal they came from.
-- Buy-side commissions are recorded at offer acceptance; sell-side commissions
-- are recorded when a listing's winning offer is picked. 'sell' rows show a
-- SELL badge in the Commissions history. Dual agency = one buy row + one sell
-- row on the same property (the commission agreed for each side beforehand).

ALTER TABLE commissions
  ADD COLUMN IF NOT EXISTS deal_side text NOT NULL DEFAULT 'buy'
  CHECK (deal_side IN ('buy','sell'));
