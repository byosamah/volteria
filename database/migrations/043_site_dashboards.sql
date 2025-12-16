-- Migration 043: Site Dashboards
-- Customizable interactive dashboards for each site
-- Allows users to create visual layouts with live data from device registers

-- =============================================================================
-- 1. SITE DASHBOARDS TABLE
-- Main configuration for each site's dashboard
-- =============================================================================

CREATE TABLE IF NOT EXISTS site_dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name TEXT DEFAULT 'Main Dashboard',

  -- Layout configuration
  grid_columns INTEGER DEFAULT 12,    -- Number of columns in the grid
  grid_rows INTEGER DEFAULT 8,        -- Number of rows in the grid

  -- Refresh settings
  refresh_interval_seconds INTEGER DEFAULT 30,  -- How often to poll for live data

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),

  -- One dashboard per site
  UNIQUE(site_id)
);

-- Index for quick lookup by site
CREATE INDEX IF NOT EXISTS idx_site_dashboards_site_id ON site_dashboards(site_id);

-- =============================================================================
-- 2. DASHBOARD WIDGETS TABLE
-- Individual widgets placed on the dashboard
-- =============================================================================

CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id UUID NOT NULL REFERENCES site_dashboards(id) ON DELETE CASCADE,

  -- Widget type: 'icon', 'value_display', 'chart', 'alarm_list', 'status_indicator'
  widget_type TEXT NOT NULL,

  -- Grid position (1-based indexing)
  grid_row INTEGER NOT NULL CHECK (grid_row >= 1),
  grid_col INTEGER NOT NULL CHECK (grid_col >= 1),
  grid_width INTEGER DEFAULT 1 CHECK (grid_width >= 1),
  grid_height INTEGER DEFAULT 1 CHECK (grid_height >= 1),

  -- Widget configuration stored as JSONB for flexibility
  -- Structure depends on widget_type - see examples in plan
  config JSONB NOT NULL DEFAULT '{}',

  -- Display order for overlapping elements (higher = on top)
  z_index INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fetching all widgets for a dashboard
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_dashboard_id ON dashboard_widgets(dashboard_id);

-- =============================================================================
-- 3. ROW LEVEL SECURITY POLICIES
-- =============================================================================

-- Enable RLS
ALTER TABLE site_dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_widgets ENABLE ROW LEVEL SECURITY;

-- Site Dashboards: Access follows site access
-- Users who can view a site can view its dashboard
CREATE POLICY "Users can view dashboards for accessible sites"
  ON site_dashboards
  FOR SELECT
  USING (
    site_id IN (
      SELECT s.id FROM sites s
      JOIN user_projects up ON up.project_id = s.project_id
      WHERE up.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('super_admin', 'backend_admin', 'admin')
    )
  );

-- Configurators and above can modify dashboards
CREATE POLICY "Configurators can modify dashboards"
  ON site_dashboards
  FOR ALL
  USING (
    site_id IN (
      SELECT s.id FROM sites s
      JOIN user_projects up ON up.project_id = s.project_id
      WHERE up.user_id = auth.uid()
      AND up.can_edit = true
    )
    OR
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('super_admin', 'backend_admin', 'admin', 'enterprise_admin', 'configurator')
    )
  );

-- Dashboard Widgets: Access follows dashboard access
CREATE POLICY "Users can view widgets for accessible dashboards"
  ON dashboard_widgets
  FOR SELECT
  USING (
    dashboard_id IN (
      SELECT sd.id FROM site_dashboards sd
      JOIN sites s ON s.id = sd.site_id
      JOIN user_projects up ON up.project_id = s.project_id
      WHERE up.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('super_admin', 'backend_admin', 'admin')
    )
  );

-- Configurators and above can modify widgets
CREATE POLICY "Configurators can modify widgets"
  ON dashboard_widgets
  FOR ALL
  USING (
    dashboard_id IN (
      SELECT sd.id FROM site_dashboards sd
      JOIN sites s ON s.id = sd.site_id
      JOIN user_projects up ON up.project_id = s.project_id
      WHERE up.user_id = auth.uid()
      AND up.can_edit = true
    )
    OR
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('super_admin', 'backend_admin', 'admin', 'enterprise_admin', 'configurator')
    )
  );

-- =============================================================================
-- 4. TRIGGER FOR updated_at
-- =============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_dashboard_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for site_dashboards
CREATE TRIGGER trigger_site_dashboards_updated_at
  BEFORE UPDATE ON site_dashboards
  FOR EACH ROW
  EXECUTE FUNCTION update_dashboard_updated_at();

-- Trigger for dashboard_widgets
CREATE TRIGGER trigger_dashboard_widgets_updated_at
  BEFORE UPDATE ON dashboard_widgets
  FOR EACH ROW
  EXECUTE FUNCTION update_dashboard_updated_at();

-- =============================================================================
-- 5. COMMENTS FOR DOCUMENTATION
-- =============================================================================

COMMENT ON TABLE site_dashboards IS 'Customizable interactive dashboards for each site';
COMMENT ON COLUMN site_dashboards.grid_columns IS 'Number of columns in the grid layout (default 12)';
COMMENT ON COLUMN site_dashboards.grid_rows IS 'Number of rows in the grid layout (default 8)';
COMMENT ON COLUMN site_dashboards.refresh_interval_seconds IS 'How often to poll for live data (default 30s)';

COMMENT ON TABLE dashboard_widgets IS 'Individual widgets placed on site dashboards';
COMMENT ON COLUMN dashboard_widgets.widget_type IS 'Type of widget: icon, value_display, chart, alarm_list, status_indicator';
COMMENT ON COLUMN dashboard_widgets.config IS 'JSONB configuration specific to widget type';
COMMENT ON COLUMN dashboard_widgets.z_index IS 'Display order for overlapping elements (higher = on top)';
