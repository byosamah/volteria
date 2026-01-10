-- Migration: 059_controller_updates.sql
-- Description: Controller OTA update tracking table
-- Created: 2026-01-10

-- ============================================================================
-- Controller Updates Table
-- Tracks OTA update status for each controller
-- ============================================================================

CREATE TABLE IF NOT EXISTS controller_updates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    controller_id UUID NOT NULL REFERENCES controllers(id) ON DELETE CASCADE,
    firmware_release_id UUID NOT NULL REFERENCES firmware_releases(id) ON DELETE CASCADE,
    from_version TEXT,
    to_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',      -- Update available, not yet started
        'approved',     -- Admin approved, waiting for controller
        'downloading',  -- Controller is downloading
        'ready',        -- Downloaded and verified, ready to apply
        'applying',     -- Update in progress
        'success',      -- Update completed successfully
        'failed',       -- Update failed
        'rolled_back',  -- Rolled back to previous version
        'cancelled'     -- Update was cancelled
    )),
    progress_pct INTEGER DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    rollback_version TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for controller lookup
CREATE INDEX idx_controller_updates_controller
    ON controller_updates(controller_id);

-- Create index for status lookup
CREATE INDEX idx_controller_updates_status
    ON controller_updates(status);

-- Create index for pending updates
CREATE INDEX idx_controller_updates_pending
    ON controller_updates(controller_id, status)
    WHERE status IN ('pending', 'approved', 'downloading', 'ready');

-- Ensure only one active update per controller at a time
CREATE UNIQUE INDEX idx_controller_updates_active
    ON controller_updates(controller_id)
    WHERE status IN ('approved', 'downloading', 'ready', 'applying');

-- ============================================================================
-- Row Level Security
-- ============================================================================

ALTER TABLE controller_updates ENABLE ROW LEVEL SECURITY;

-- Super admins and backend admins can manage all updates
CREATE POLICY "Super/backend admins can manage all updates"
    ON controller_updates
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('super_admin', 'backend_admin')
        )
    );

-- Users can view updates for controllers in their sites
CREATE POLICY "Users can view updates for their controllers"
    ON controller_updates
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM controllers cm
            JOIN site_master_devices smd ON smd.controller_id = cm.id
            JOIN sites s ON s.id = smd.site_id
            JOIN user_projects up ON up.project_id = s.project_id
            WHERE cm.id = controller_updates.controller_id
            AND up.user_id = auth.uid()
        )
    );

-- Enterprise admins can approve updates for their enterprise's controllers
CREATE POLICY "Enterprise admins can approve updates"
    ON controller_updates
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM users u
            JOIN controllers cm ON cm.enterprise_id = u.enterprise_id
            WHERE u.id = auth.uid()
            AND u.role IN ('enterprise_admin', 'admin')
            AND cm.id = controller_updates.controller_id
        )
    );

-- ============================================================================
-- Triggers
-- ============================================================================

-- Update updated_at timestamp on changes
CREATE OR REPLACE FUNCTION update_controller_updates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_controller_updates_updated_at
    BEFORE UPDATE ON controller_updates
    FOR EACH ROW
    EXECUTE FUNCTION update_controller_updates_updated_at();

-- Set timestamps based on status changes
CREATE OR REPLACE FUNCTION handle_controller_update_status_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Set started_at when update begins downloading
    IF NEW.status = 'downloading' AND OLD.status IN ('pending', 'approved') THEN
        NEW.started_at = NOW();
    END IF;

    -- Set approved_at when status changes to approved
    IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
        NEW.approved_at = NOW();
    END IF;

    -- Set completed_at when update finishes
    IF NEW.status IN ('success', 'failed', 'rolled_back', 'cancelled')
       AND OLD.status NOT IN ('success', 'failed', 'rolled_back', 'cancelled') THEN
        NEW.completed_at = NOW();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_controller_update_status_change
    BEFORE UPDATE ON controller_updates
    FOR EACH ROW
    EXECUTE FUNCTION handle_controller_update_status_change();

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to check if controller has pending update
CREATE OR REPLACE FUNCTION controller_has_pending_update(p_controller_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM controller_updates
        WHERE controller_id = p_controller_id
        AND status IN ('pending', 'approved', 'downloading', 'ready', 'applying')
    );
END;
$$ LANGUAGE plpgsql;

-- Function to get latest available update for a controller
CREATE OR REPLACE FUNCTION get_available_update(p_controller_id UUID)
RETURNS TABLE (
    update_id UUID,
    release_id UUID,
    version TEXT,
    release_type TEXT,
    release_notes TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        cu.id as update_id,
        fr.id as release_id,
        fr.version,
        fr.release_type,
        fr.release_notes
    FROM controller_updates cu
    JOIN firmware_releases fr ON fr.id = cu.firmware_release_id
    WHERE cu.controller_id = p_controller_id
    AND cu.status = 'pending'
    ORDER BY fr.created_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE controller_updates IS 'Tracks OTA firmware update status for each controller';
COMMENT ON COLUMN controller_updates.status IS 'Current update status in the lifecycle';
COMMENT ON COLUMN controller_updates.progress_pct IS 'Download/apply progress percentage';
COMMENT ON COLUMN controller_updates.approved_by IS 'User who approved the update';
COMMENT ON COLUMN controller_updates.from_version IS 'Version before update (captured at start)';
COMMENT ON COLUMN controller_updates.to_version IS 'Target version to update to';
COMMENT ON COLUMN controller_updates.rollback_version IS 'Version to rollback to if update fails';
COMMENT ON COLUMN controller_updates.metadata IS 'Additional update metadata (logs, checksums, etc.)';
