-- Migration: 036_alarm_definitions_structure.sql
-- Purpose: Add alarm_definitions JSONB column to device_templates table
-- This provides structured alarm definitions with threshold conditions (different from alarm_registers)

-- =============================================================================
-- ADD ALARM DEFINITIONS COLUMN TO DEVICE TEMPLATES
-- =============================================================================

-- Add alarm_definitions column if it doesn't exist
ALTER TABLE device_templates
ADD COLUMN IF NOT EXISTS alarm_definitions JSONB DEFAULT '[]';

-- Add comment explaining the structure
COMMENT ON COLUMN device_templates.alarm_definitions IS
'Structured alarm definitions with threshold conditions. Format:
[{
  "id": "string",                    -- Unique alarm ID (e.g., "inverter_offline")
  "name": "string",                  -- Display name
  "description": "string",           -- Detailed description
  "source_type": "modbus_register" | "device_info" | "calculated_field" | "heartbeat",
  "source_key": "string",            -- Register name or field name
  "conditions": [{
    "operator": ">" | ">=" | "<" | "<=" | "==" | "!=",
    "value": number,
    "severity": "info" | "warning" | "major" | "critical",
    "message": "string"
  }],
  "enabled_by_default": boolean,
  "cooldown_seconds": number         -- Deduplication cooldown
}]
Different from alarm_registers which stores raw Modbus register addresses.';

-- =============================================================================
-- ADD DEFAULT ALARM DEFINITIONS TO EXISTING TEMPLATES
-- =============================================================================

-- Sungrow inverter alarms
UPDATE device_templates
SET alarm_definitions = '[
    {
        "id": "inverter_offline",
        "name": "Inverter Offline",
        "description": "Lost Modbus communication with inverter",
        "source_type": "heartbeat",
        "source_key": "last_communication_seconds",
        "conditions": [
            {"operator": ">", "value": 30, "severity": "critical", "message": "No communication for 30+ seconds"}
        ],
        "enabled_by_default": true,
        "cooldown_seconds": 60
    },
    {
        "id": "inverter_low_output",
        "name": "Low Power Output",
        "description": "Inverter producing less power than expected during daylight",
        "source_type": "modbus_register",
        "source_key": "active_power",
        "conditions": [
            {"operator": "<", "value": 5, "severity": "warning", "message": "Power output below 5 kW during daylight"}
        ],
        "enabled_by_default": false,
        "cooldown_seconds": 900
    }
]'::JSONB
WHERE template_id LIKE 'sungrow%' AND (alarm_definitions IS NULL OR alarm_definitions = '[]'::JSONB);

-- Meatrol meter alarms
UPDATE device_templates
SET alarm_definitions = '[
    {
        "id": "meter_offline",
        "name": "Meter Offline",
        "description": "Lost Modbus communication with power meter",
        "source_type": "heartbeat",
        "source_key": "last_communication_seconds",
        "conditions": [
            {"operator": ">", "value": 30, "severity": "critical", "message": "No communication for 30+ seconds"}
        ],
        "enabled_by_default": true,
        "cooldown_seconds": 60
    },
    {
        "id": "power_factor_low",
        "name": "Low Power Factor",
        "description": "Power factor is below acceptable threshold",
        "source_type": "modbus_register",
        "source_key": "power_factor",
        "conditions": [
            {"operator": "<", "value": 0.8, "severity": "warning", "message": "Power factor below 0.8"},
            {"operator": "<", "value": 0.7, "severity": "major", "message": "Power factor critically low"}
        ],
        "enabled_by_default": false,
        "cooldown_seconds": 600
    }
]'::JSONB
WHERE template_id LIKE 'meatrol%' AND (alarm_definitions IS NULL OR alarm_definitions = '[]'::JSONB);

-- ComAp DG controller alarms
UPDATE device_templates
SET alarm_definitions = '[
    {
        "id": "dg_offline",
        "name": "DG Controller Offline",
        "description": "Lost Modbus communication with DG controller",
        "source_type": "heartbeat",
        "source_key": "last_communication_seconds",
        "conditions": [
            {"operator": ">", "value": 30, "severity": "critical", "message": "No communication for 30+ seconds"}
        ],
        "enabled_by_default": true,
        "cooldown_seconds": 60
    }
]'::JSONB
WHERE template_id LIKE 'comap%' AND (alarm_definitions IS NULL OR alarm_definitions = '[]'::JSONB);
