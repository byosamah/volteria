-- Migration 039: Usage Packages & Enterprise Usage Tracking
-- PHASE 6 - Billing & Storage Management
--
-- Creates the billing package system and extends enterprises table
-- to track storage usage, grace periods, and package assignments.
--
-- Features:
-- - Usage packages with storage/bandwidth limits
-- - Enterprise package assignment
-- - Grace period tracking for over-limit enterprises

-- ================================================================
-- STEP 1: Create usage_packages table
-- ================================================================

CREATE TABLE IF NOT EXISTS usage_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Package identity
  name VARCHAR(50) NOT NULL,              -- "Starter", "Professional", "Enterprise"
  description TEXT,                       -- Package description for display

  -- Storage limits (in bytes)
  storage_limit_bytes BIGINT NOT NULL,    -- e.g., 5GB = 5368709120
  bandwidth_limit_bytes BIGINT,           -- Monthly bandwidth limit (nullable = unlimited)

  -- Resource limits
  max_sites INTEGER,                      -- NULL = unlimited
  max_controllers INTEGER,                -- NULL = unlimited
  max_users INTEGER,                      -- NULL = unlimited

  -- Pricing (for display/reference only)
  price_monthly DECIMAL(10,2),            -- Monthly price in USD
  price_yearly DECIMAL(10,2),             -- Yearly price in USD

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER DEFAULT 0,        -- For sorting in UI

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for active packages
CREATE INDEX IF NOT EXISTS idx_usage_packages_active
  ON usage_packages(is_active, display_order);

-- ================================================================
-- STEP 2: Extend enterprises table with usage tracking columns
-- ================================================================

-- Add package assignment column
ALTER TABLE enterprises
  ADD COLUMN IF NOT EXISTS usage_package_id UUID REFERENCES usage_packages(id);

-- Add grace period tracking (when enterprise exceeds limit)
ALTER TABLE enterprises
  ADD COLUMN IF NOT EXISTS usage_grace_period_start TIMESTAMPTZ;

-- Track when last warning was sent (avoid spam)
ALTER TABLE enterprises
  ADD COLUMN IF NOT EXISTS usage_warning_sent_at TIMESTAMPTZ;

-- Track current usage level for quick filtering
ALTER TABLE enterprises
  ADD COLUMN IF NOT EXISTS usage_warning_level VARCHAR(20) DEFAULT 'normal';
  -- Values: 'normal', 'approaching' (80%+), 'exceeded' (100%+), 'critical' (110%+)

-- ================================================================
-- STEP 3: Enable RLS on usage_packages
-- ================================================================

ALTER TABLE usage_packages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for re-run safety
DROP POLICY IF EXISTS "Anyone can view active packages" ON usage_packages;
DROP POLICY IF EXISTS "Only super_admin can manage packages" ON usage_packages;

-- Anyone can view active packages (for display in UI)
CREATE POLICY "Anyone can view active packages"
  ON usage_packages
  FOR SELECT
  USING (is_active = true);

-- Only super_admin can manage packages
CREATE POLICY "Only super_admin can manage packages"
  ON usage_packages
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role = 'super_admin'
    )
  );

-- ================================================================
-- STEP 4: Insert default packages
-- ================================================================

-- Starter Package: 5 GB storage, 10 GB bandwidth, 3 sites, 5 controllers
INSERT INTO usage_packages (name, description, storage_limit_bytes, bandwidth_limit_bytes, max_sites, max_controllers, max_users, price_monthly, display_order)
VALUES (
  'Starter',
  'Perfect for small installations with up to 3 sites',
  5368709120,     -- 5 GB
  10737418240,    -- 10 GB
  3,              -- max sites
  5,              -- max controllers
  5,              -- max users
  49.00,
  1
)
ON CONFLICT DO NOTHING;

-- Professional Package: 25 GB storage, 50 GB bandwidth, 10 sites, 25 controllers
INSERT INTO usage_packages (name, description, storage_limit_bytes, bandwidth_limit_bytes, max_sites, max_controllers, max_users, price_monthly, display_order)
VALUES (
  'Professional',
  'For growing businesses managing multiple sites',
  26843545600,    -- 25 GB
  53687091200,    -- 50 GB
  10,             -- max sites
  25,             -- max controllers
  20,             -- max users
  149.00,
  2
)
ON CONFLICT DO NOTHING;

-- Enterprise Package: 100 GB storage, 200 GB bandwidth, unlimited sites/controllers
INSERT INTO usage_packages (name, description, storage_limit_bytes, bandwidth_limit_bytes, max_sites, max_controllers, max_users, price_monthly, display_order)
VALUES (
  'Enterprise',
  'Unlimited scale for large organizations',
  107374182400,   -- 100 GB
  214748364800,   -- 200 GB
  NULL,           -- unlimited sites
  NULL,           -- unlimited controllers
  NULL,           -- unlimited users
  499.00,
  3
)
ON CONFLICT DO NOTHING;

-- ================================================================
-- STEP 5: Create updated_at trigger for usage_packages
-- ================================================================

CREATE OR REPLACE FUNCTION update_usage_packages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_usage_packages_updated_at ON usage_packages;

CREATE TRIGGER trigger_usage_packages_updated_at
  BEFORE UPDATE ON usage_packages
  FOR EACH ROW
  EXECUTE FUNCTION update_usage_packages_updated_at();

-- ================================================================
-- STEP 6: Helper function to get enterprise's package limits
-- ================================================================

CREATE OR REPLACE FUNCTION get_enterprise_package_limits(p_enterprise_id UUID)
RETURNS TABLE (
  package_name VARCHAR,
  storage_limit_bytes BIGINT,
  bandwidth_limit_bytes BIGINT,
  max_sites INTEGER,
  max_controllers INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    up.name,
    up.storage_limit_bytes,
    up.bandwidth_limit_bytes,
    up.max_sites,
    up.max_controllers
  FROM enterprises e
  LEFT JOIN usage_packages up ON e.usage_package_id = up.id
  WHERE e.id = p_enterprise_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- STEP 7: Documentation
-- ================================================================

COMMENT ON TABLE usage_packages IS 'Billing packages defining storage, bandwidth, and resource limits for enterprises';
COMMENT ON COLUMN usage_packages.storage_limit_bytes IS 'Maximum storage in bytes (5GB = 5368709120)';
COMMENT ON COLUMN usage_packages.bandwidth_limit_bytes IS 'Monthly bandwidth limit in bytes, NULL = unlimited';
COMMENT ON COLUMN usage_packages.max_sites IS 'Maximum number of sites, NULL = unlimited';

COMMENT ON COLUMN enterprises.usage_package_id IS 'Assigned billing package, NULL = no limits (legacy/special accounts)';
COMMENT ON COLUMN enterprises.usage_grace_period_start IS 'When enterprise exceeded limit, starts 30-day grace period';
COMMENT ON COLUMN enterprises.usage_warning_level IS 'Current warning level: normal, approaching (80%+), exceeded (100%+), critical (110%+)';
