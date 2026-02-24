# Volteria Backlog

## Pending

### BL-1: Verify Doha Quarry controller config
- **Priority**: high
- **Created**: 2026-02-24
- **Blocker**: Controller e129006b9b0a64c3 must be online
- **Context**: Timezone was set to Asia/Dubai in DB, but timezone isn't in config hash — controller won't auto-pick it up. Need to SSH in and restart config service.
- **Steps**:
  1. SSH into controller e129006b9b0a64c3 (Line 4 Primary, Doha Quarry)
  2. Verify `/run/volteria/state/config.json` has `logging_frequency: 600` for sum fields
  3. Restart config service: `sudo systemctl restart volteria-config`
  4. Verify config reloads with new timezone in logs
- **Related**: Project ID `4f40a682-2f63-46b2-87d3-6e8e80853651`

### BL-2: Add timezone validation warning in site settings UI
- **Priority**: low
- **Created**: 2026-02-24
- **Blocker**: none
- **Context**: NULL project timezone causes silent time-window misalignment (UTC instead of local). Users get no warning. Show a banner in site settings when project has no timezone: "Timezone not configured — data will use UTC. Set timezone in Project Settings."
- **Files**: `frontend/src/` — find site settings component

### BL-3: Include timezone in controller config hash
- **Priority**: medium
- **Created**: 2026-02-24
- **Blocker**: none
- **Context**: Changing timezone in DB doesn't trigger config reload on controller. Must manually restart config service. Adding timezone to config hash makes it auto-reload.
- **Files**: `controller/services/config/service.py` (hash computation)
- **Also update**: CLAUDE.md note 50 — remove "must restart config service" caveat

### BL-4: Make project timezone NOT NULL in database
- **Priority**: medium
- **Created**: 2026-02-24
- **Blocker**: none
- **Context**: Prevent NULL timezone from ever happening. Every project needs a timezone for correct time-window alignment.
- **Steps**:
  1. Update any existing NULL timezone projects to 'UTC'
  2. Migration: `ALTER TABLE projects ALTER COLUMN timezone SET NOT NULL, ALTER COLUMN timezone SET DEFAULT 'UTC'`
  3. Verify frontend project creation form requires timezone selection
- **Risk**: Check if any code creates projects without timezone before adding constraint

## In Progress

_(none)_

## Done

_(none)_
