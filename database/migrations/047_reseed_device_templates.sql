-- ============================================
-- Migration: 047_reseed_device_templates
-- Purpose: Re-insert device templates with updated column structure
-- Note: Uses logging_registers (not registers) and includes all mandatory fields
-- ============================================

-- ============================================
-- SUNGROW INVERTERS
-- ============================================

-- Sungrow SG150KTL-M (150 kW)
INSERT INTO device_templates (
    template_id,
    name,
    device_type,
    operation,
    brand,
    model,
    rated_power_kw,
    template_type,
    logging_registers,
    visualization_registers,
    calculated_fields,
    specifications
) VALUES (
    'sungrow_150kw',
    'Sungrow SG150KTL-M',
    'inverter',
    'solar',
    'Sungrow',
    'SG150KTL-M',
    150.0,
    'public',
    '[
        {"address": 5006, "name": "inverter_control", "description": "Inverter Control Command", "type": "holding", "access": "write", "datatype": "uint16", "values": {"start": "0xCF", "stop": "0xCE", "e_stop": "0xBB"}},
        {"address": 5007, "name": "power_limit_switch", "description": "Power Limitation Enable/Disable", "type": "holding", "access": "write", "datatype": "uint16", "values": {"enable": "0xAA", "disable": "0x55"}},
        {"address": 5008, "name": "power_limit_pct", "description": "Active Power Limit Percentage", "type": "holding", "access": "readwrite", "datatype": "uint16", "scale": 1, "unit": "%", "min": 0, "max": 100},
        {"address": 5031, "name": "active_power", "description": "Active Power Output", "type": "input", "access": "read", "datatype": "uint16", "scale": 0.1, "unit": "kW"},
        {"address": 5038, "name": "inverter_state", "description": "Inverter Operating State", "type": "input", "access": "read", "datatype": "uint16"},
        {"address": 5011, "name": "ac_voltage", "description": "AC Output Voltage", "type": "input", "access": "read", "datatype": "uint16", "scale": 0.1, "unit": "V"},
        {"address": 5012, "name": "ac_current", "description": "AC Output Current", "type": "input", "access": "read", "datatype": "uint16", "scale": 0.1, "unit": "A"},
        {"address": 5001, "name": "dc_voltage", "description": "DC Input Voltage", "type": "input", "access": "read", "datatype": "uint16", "scale": 0.1, "unit": "V"},
        {"address": 5002, "name": "dc_current", "description": "DC Input Current", "type": "input", "access": "read", "datatype": "uint16", "scale": 0.01, "unit": "A"}
    ]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '{
        "max_dc_voltage": 1100,
        "mppt_voltage_range": "200-1000V",
        "ac_voltage_range": "380V 3-phase",
        "efficiency": "98.7%",
        "communication": "RS485 Modbus RTU"
    }'::jsonb
) ON CONFLICT (template_id) DO UPDATE SET
    name = EXCLUDED.name,
    logging_registers = EXCLUDED.logging_registers,
    template_type = EXCLUDED.template_type,
    specifications = EXCLUDED.specifications,
    updated_at = NOW();

-- Sungrow SG110CX (110 kW)
INSERT INTO device_templates (
    template_id,
    name,
    device_type,
    operation,
    brand,
    model,
    rated_power_kw,
    template_type,
    logging_registers,
    visualization_registers,
    calculated_fields,
    specifications
) VALUES (
    'sungrow_110kw',
    'Sungrow SG110CX',
    'inverter',
    'solar',
    'Sungrow',
    'SG110CX',
    110.0,
    'public',
    '[
        {"address": 5006, "name": "inverter_control", "description": "Inverter Control Command", "type": "holding", "access": "write", "datatype": "uint16", "values": {"start": "0xCF", "stop": "0xCE", "e_stop": "0xBB"}},
        {"address": 5007, "name": "power_limit_switch", "description": "Power Limitation Enable/Disable", "type": "holding", "access": "write", "datatype": "uint16", "values": {"enable": "0xAA", "disable": "0x55"}},
        {"address": 5008, "name": "power_limit_pct", "description": "Active Power Limit Percentage", "type": "holding", "access": "readwrite", "datatype": "uint16", "scale": 1, "unit": "%", "min": 0, "max": 100},
        {"address": 5031, "name": "active_power", "description": "Active Power Output", "type": "input", "access": "read", "datatype": "uint16", "scale": 0.1, "unit": "kW"},
        {"address": 5038, "name": "inverter_state", "description": "Inverter Operating State", "type": "input", "access": "read", "datatype": "uint16"},
        {"address": 5011, "name": "ac_voltage", "description": "AC Output Voltage", "type": "input", "access": "read", "datatype": "uint16", "scale": 0.1, "unit": "V"},
        {"address": 5012, "name": "ac_current", "description": "AC Output Current", "type": "input", "access": "read", "datatype": "uint16", "scale": 0.1, "unit": "A"}
    ]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '{
        "max_dc_voltage": 1100,
        "mppt_voltage_range": "200-1000V",
        "ac_voltage_range": "380V 3-phase",
        "efficiency": "98.6%",
        "communication": "RS485 Modbus RTU"
    }'::jsonb
) ON CONFLICT (template_id) DO UPDATE SET
    name = EXCLUDED.name,
    logging_registers = EXCLUDED.logging_registers,
    template_type = EXCLUDED.template_type,
    specifications = EXCLUDED.specifications,
    updated_at = NOW();

-- ============================================
-- MEATROL POWER METERS
-- ============================================

-- Meatrol ME431 Power Meter
INSERT INTO device_templates (
    template_id,
    name,
    device_type,
    operation,
    brand,
    model,
    template_type,
    logging_registers,
    visualization_registers,
    calculated_fields,
    specifications
) VALUES (
    'meatrol_me431',
    'Meatrol ME431',
    'load_meter',
    'meter',
    'Meatrol',
    'ME431',
    'public',
    '[
        {"address": 1000, "name": "voltage_a", "description": "Phase A Voltage", "type": "input", "access": "read", "datatype": "float32", "unit": "V"},
        {"address": 1002, "name": "voltage_b", "description": "Phase B Voltage", "type": "input", "access": "read", "datatype": "float32", "unit": "V"},
        {"address": 1004, "name": "voltage_c", "description": "Phase C Voltage", "type": "input", "access": "read", "datatype": "float32", "unit": "V"},
        {"address": 1016, "name": "current_a", "description": "Phase A Current", "type": "input", "access": "read", "datatype": "float32", "unit": "A"},
        {"address": 1018, "name": "current_b", "description": "Phase B Current", "type": "input", "access": "read", "datatype": "float32", "unit": "A"},
        {"address": 1020, "name": "current_c", "description": "Phase C Current", "type": "input", "access": "read", "datatype": "float32", "unit": "A"},
        {"address": 1032, "name": "total_active_power", "description": "Total Active Power", "type": "input", "access": "read", "datatype": "float32", "unit": "W"},
        {"address": 1040, "name": "total_reactive_power", "description": "Total Reactive Power", "type": "input", "access": "read", "datatype": "float32", "unit": "VAr"},
        {"address": 1048, "name": "total_apparent_power", "description": "Total Apparent Power", "type": "input", "access": "read", "datatype": "float32", "unit": "VA"},
        {"address": 1056, "name": "power_factor", "description": "Average Power Factor", "type": "input", "access": "read", "datatype": "float32"},
        {"address": 1066, "name": "frequency", "description": "Grid Frequency", "type": "input", "access": "read", "datatype": "float32", "unit": "Hz"},
        {"address": 4006, "name": "total_positive_energy", "description": "Total Positive Active Energy", "type": "input", "access": "read", "datatype": "uint32", "scale": 0.1, "unit": "kWh"}
    ]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '{
        "measurement_type": "3-phase 4-wire",
        "voltage_range": "3x57.7V/100V to 3x277V/480V",
        "current_range": "5A (1A or 5A CT)",
        "accuracy_class": "0.5S",
        "communication": "RS485 Modbus RTU"
    }'::jsonb
) ON CONFLICT (template_id) DO UPDATE SET
    name = EXCLUDED.name,
    logging_registers = EXCLUDED.logging_registers,
    template_type = EXCLUDED.template_type,
    specifications = EXCLUDED.specifications,
    updated_at = NOW();

-- ============================================
-- COMAP DG CONTROLLERS
-- ============================================

-- ComAp InteliGen 500
INSERT INTO device_templates (
    template_id,
    name,
    device_type,
    operation,
    brand,
    model,
    template_type,
    logging_registers,
    visualization_registers,
    calculated_fields,
    specifications
) VALUES (
    'comap_ig500',
    'ComAp InteliGen 500',
    'dg',
    'dg',
    'ComAp',
    'InteliGen 500',
    'public',
    '[
        {"address": 100, "name": "active_power", "description": "Generator Active Power", "type": "input", "access": "read", "datatype": "int16", "scale": 1, "unit": "kW", "note": "Address TBD - placeholder"},
        {"address": 102, "name": "voltage_l1", "description": "Generator Voltage L1", "type": "input", "access": "read", "datatype": "uint16", "scale": 1, "unit": "V", "note": "Address TBD - placeholder"},
        {"address": 104, "name": "current_l1", "description": "Generator Current L1", "type": "input", "access": "read", "datatype": "uint16", "scale": 1, "unit": "A", "note": "Address TBD - placeholder"},
        {"address": 106, "name": "frequency", "description": "Generator Frequency", "type": "input", "access": "read", "datatype": "uint16", "scale": 0.1, "unit": "Hz", "note": "Address TBD - placeholder"},
        {"address": 108, "name": "running_hours", "description": "Engine Running Hours", "type": "input", "access": "read", "datatype": "uint32", "scale": 1, "unit": "h", "note": "Address TBD - placeholder"},
        {"address": 110, "name": "engine_state", "description": "Engine State", "type": "input", "access": "read", "datatype": "uint16", "values": {"off": 0, "running": 1, "fault": 2}, "note": "Address TBD - placeholder"},
        {"address": 112, "name": "gcb_status", "description": "Generator Circuit Breaker Status", "type": "input", "access": "read", "datatype": "uint16", "values": {"open": 0, "closed": 1}, "note": "Address TBD - placeholder"}
    ]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '{
        "controller_type": "Generator Controller",
        "firmware": "GeCon-MARINE",
        "communication": "Modbus TCP/RTU",
        "note": "Register addresses need to be confirmed from ComAp documentation or GenConfig software"
    }'::jsonb
) ON CONFLICT (template_id) DO UPDATE SET
    name = EXCLUDED.name,
    logging_registers = EXCLUDED.logging_registers,
    template_type = EXCLUDED.template_type,
    specifications = EXCLUDED.specifications,
    updated_at = NOW();

-- ============================================
-- FUTURE TEMPLATES (Placeholders)
-- ============================================

-- GoodWe GW100K-MT (100 kW) - Placeholder
INSERT INTO device_templates (
    template_id,
    name,
    device_type,
    operation,
    brand,
    model,
    rated_power_kw,
    template_type,
    logging_registers,
    visualization_registers,
    calculated_fields,
    specifications,
    is_active
) VALUES (
    'goodwe_100kw',
    'GoodWe GW100K-MT',
    'inverter',
    'solar',
    'GoodWe',
    'GW100K-MT',
    100.0,
    'public',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '{"note": "Template placeholder - registers TBD"}'::jsonb,
    FALSE
) ON CONFLICT (template_id) DO NOTHING;

-- Huawei SUN2000-100KTL (100 kW) - Placeholder
INSERT INTO device_templates (
    template_id,
    name,
    device_type,
    operation,
    brand,
    model,
    rated_power_kw,
    template_type,
    logging_registers,
    visualization_registers,
    calculated_fields,
    specifications,
    is_active
) VALUES (
    'huawei_100kw',
    'Huawei SUN2000-100KTL',
    'inverter',
    'solar',
    'Huawei',
    'SUN2000-100KTL',
    100.0,
    'public',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '{"note": "Template placeholder - registers TBD"}'::jsonb,
    FALSE
) ON CONFLICT (template_id) DO NOTHING;
