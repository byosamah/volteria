-- Migration: Site Test Results
-- Purpose: Store results from quick diagnostic tests run on sites
-- Used to verify device communication and control logic after config sync

-- Table for storing site test results
CREATE TABLE IF NOT EXISTS site_test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Timing
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  -- Overall status
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'passed', 'failed', 'partial')),

  -- Individual test results (JSON array)
  -- Each item: { device_name, device_type, status, message, value }
  results JSONB DEFAULT '[]',

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying tests by site
CREATE INDEX IF NOT EXISTS idx_site_test_results_site_id ON site_test_results(site_id);

-- Index for querying recent tests
CREATE INDEX IF NOT EXISTS idx_site_test_results_created_at ON site_test_results(created_at DESC);

-- RLS policies
ALTER TABLE site_test_results ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view test results for sites they have access to
CREATE POLICY "Users can view test results for accessible sites"
  ON site_test_results
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM sites s
      JOIN projects p ON s.project_id = p.id
      LEFT JOIN user_projects up ON p.id = up.project_id
      WHERE s.id = site_test_results.site_id
      AND (
        up.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = auth.uid()
          AND u.role IN ('super_admin', 'backend_admin', 'admin')
        )
      )
    )
  );

-- Allow authenticated users to create test results
CREATE POLICY "Users can create test results"
  ON site_test_results
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow updates (for completing tests)
CREATE POLICY "Users can update test results"
  ON site_test_results
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Comment
COMMENT ON TABLE site_test_results IS 'Stores diagnostic test results for sites, used to verify device communication and control logic';
