-- ============================================
-- Migration 052: Enterprise Subscription Plan
-- ============================================
-- Adds subscription_plan column to enterprises table
-- Plans: starter, advanced, pro

-- Add subscription_plan column
ALTER TABLE enterprises
ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'starter';

-- Add check constraint for valid plan values
ALTER TABLE enterprises
ADD CONSTRAINT check_subscription_plan
CHECK (subscription_plan IN ('starter', 'advanced', 'pro'));

-- Add comment
COMMENT ON COLUMN enterprises.subscription_plan IS 'Subscription tier: starter, advanced, or pro';

-- Create index for filtering by plan
CREATE INDEX IF NOT EXISTS idx_enterprises_subscription_plan ON enterprises(subscription_plan);
