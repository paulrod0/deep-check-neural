-- 005_paddle.sql — Add Paddle payment provider columns
ALTER TABLE dc_organizations
  ADD COLUMN IF NOT EXISTS paddle_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS paddle_price_id TEXT;

COMMENT ON COLUMN dc_organizations.paddle_customer_id IS 'Paddle customer ID (ctm_...)';
COMMENT ON COLUMN dc_organizations.paddle_subscription_id IS 'Paddle subscription ID (sub_...)';
COMMENT ON COLUMN dc_organizations.paddle_price_id IS 'Paddle price ID (pri_...)';
