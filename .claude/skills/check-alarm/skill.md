# Check Alarm - Volteria Alarm System Diagnostics

> Diagnose alarm configuration, deduplication, auto-resolution, and data flow.

## Trigger Conditions

Activate this skill when:
- User mentions: "check alarm", "alarm diagnostics", "duplicate alarms", "alarm not resolving", "alarm not triggering"
- Files touched: `controller/services/logging/service.py`, `controller/services/logging/alarm_evaluator.py`, `controller/services/logging/cloud_sync.py`, `controller/services/logging/local_db.py`
- Topics: threshold alarms, device alarms, connection alarms, alarm deduplication, auto-resolution, orphan alarms

---

## 0. Quick Commands

**Identify site and controller**:
```sql
SELECT s.id as site_id, s.name as site_name, c.serial_number, c.ssh_port, c.ssh_username, c.ssh_password
FROM sites s
JOIN controllers c ON c.site_id = s.id
WHERE s.name ILIKE '%SITE_NAME%';
```

**Check active alarms for a site**:
```sql
SELECT id, alarm_type, device_name, condition, message, severity, acknowledged, resolved, created_at
FROM alarms
WHERE site_id = 'SITE_UUID' AND resolved = false
ORDER BY created_at DESC;
```

**Check duplicate alarms** (same alarm_type, multiple unresolved):
```sql
SELECT alarm_type, device_name, COUNT(*) as count
FROM alarms
WHERE site_id = 'SITE_UUID' AND resolved = false
GROUP BY alarm_type, device_name
HAVING COUNT(*) > 1;
```

**Check device alarm config**:
```sql
SELECT sd.name, sd.alarm_registers, sd.connection_alarm_enabled, sd.connection_alarm_severity
FROM site_devices sd
WHERE sd.site_id = 'SITE_UUID';
```

---

## 1. Alarm Sources

| Source | Type | Trigger | Location |
|--------|------|---------|----------|
| Device register thresholds | `reg_{device_id}_{register_name}` | Value crosses threshold | `service.py:_evaluate_alarms()` |
| Device connection | `not_reporting` | No data for 10 min | DB cron `check_device_connection_status()` |
| Controller heartbeat | Checked via `is_site_controller_online()` | No heartbeat for 2 min | DB RPC |
| Logging drift | `LOGGING_HIGH_DRIFT` | Scheduler drift > 5000ms | `service.py:_check_logging_health()` |

---

## 2. Alarm Flow (Device Threshold)

```
Device Readings (SharedState)
       ↓
AlarmEvaluator.evaluate() - checks readings vs definitions
       ↓
Returns triggered[] with cooldown tracking (300s default)
       ↓
_evaluate_alarms() - tracks _previously_triggered_ids
       ↓
For cleared conditions → auto-resolve via resolve_alarms_by_type()
       ↓
For triggered alarms → _process_alarm()
       ↓
has_unresolved_alarm() - LOCAL SQLite check
       ↓ (if critical/major)
check_unresolved_alarm() - CLOUD Supabase check
       ↓
insert_alarm() → SQLite → Cloud sync
```

---

## 3. Deduplication Mechanisms

### A) Cooldown (300s)
- Prevents rapid re-triggers of same condition
- Tracked in `AlarmEvaluator._alarm_states`
- Per alarm_id + device_id

### B) Local SQLite Check
- `has_unresolved_alarm(site_id, alarm_type, device_name)`
- Blocks new alarm if unresolved exists locally

### C) Cloud Check (critical/major only)
- `check_unresolved_alarm()` queries Supabase
- Fallback when local DB state unreliable

---

## 4. Auto-Resolution Triggers

| Trigger | When | Method |
|---------|------|--------|
| **Condition clears** | Value no longer triggers threshold | `_evaluate_alarms()` tracks `_previously_triggered_ids` |
| **Threshold changed** | User modifies config | `_reevaluate_alarms_after_config_change()` |
| **Definition deleted** | Register removed from config | Orphan resolution in `_config_watch_loop()` |
| **Device reconnects** | `not_reporting` alarm | DB cron `resolve_not_reporting_alarm()` |
| **Drift recovers** | 3 consecutive healthy checks | `_check_logging_health()` |

---

## 5. Diagnostic Queries

### Check alarm config for a device
```sql
SELECT
  sd.name as device_name,
  sd.alarm_registers,
  dt.alarm_registers as template_alarm_registers
FROM site_devices sd
LEFT JOIN device_templates dt ON sd.template_id = dt.id
WHERE sd.id = 'DEVICE_UUID';
```

### Check recent alarm activity
```sql
SELECT
  alarm_type, device_name, condition, severity,
  acknowledged, resolved,
  created_at, resolved_at
FROM alarms
WHERE site_id = 'SITE_UUID'
ORDER BY created_at DESC
LIMIT 20;
```

### Check if duplicates exist
```sql
SELECT alarm_type, device_name, COUNT(*) as dup_count,
  MIN(created_at) as first_created,
  MAX(created_at) as last_created
FROM alarms
WHERE site_id = 'SITE_UUID' AND resolved = false
GROUP BY alarm_type, device_name
HAVING COUNT(*) > 1;
```

### Get current device reading
```sql
SELECT register_name, value, timestamp
FROM device_readings
WHERE device_id = 'DEVICE_UUID'
  AND register_name = 'REGISTER_NAME'
ORDER BY timestamp DESC LIMIT 1;
```

---

## 6. SSH Diagnostics (Controller)

**Check local SQLite alarm state**:
```bash
sqlite3 /opt/volteria/data/controller.db "SELECT alarm_type, device_name, resolved, COUNT(*) FROM alarms WHERE resolved = 0 GROUP BY alarm_type, device_name"
```

**Check unsynced alarms**:
```bash
sqlite3 /opt/volteria/data/controller.db "SELECT COUNT(*) FROM alarms WHERE synced_at IS NULL"
```

**Check alarm definitions loaded**:
```bash
curl -s http://127.0.0.1:8085/debug | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Alarm definitions: {d.get(\"alarm_definitions_count\", \"N/A\")}')"
```

**Check logging service logs for alarm activity**:
```bash
journalctl -u volteria-logging --since "10 min ago" | grep -iE "alarm|auto-resolved|condition cleared"
```

---

## 7. Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| **Duplicate alarms** | Resolution sync was marking local resolved | Fixed: Skip resolution sync for `reg_*` alarms |
| **Alarm not resolving** | No condition-clear detection | Fixed: Track `active_conditions`, auto-resolve |
| **Alarm triggers after resolve** | User resolved in UI, cooldown expired | Fixed: Cloud dedup check for critical/major |
| **Threshold change not reflected** | No re-evaluation after config | Fixed: `_reevaluate_alarms_after_config_change()` |
| **Orphan alarm stays active** | Definition deleted but alarm not resolved | Already implemented: orphan resolution on config change |
| **Immediate auto-resolve** | Cooldown prevented re-trigger, looked like "cleared" | Fixed: Separate `active_conditions` from `triggered` |
| **Wrong SharedState key** | Used `SharedState.get("device_readings")` | Fixed: Use `SharedState.read("readings").devices.{id}.readings` |

---

## 8. Validation Checklist

- [ ] Threshold triggers alarm when condition met
- [ ] NO duplicate alarm after cooldown (5 min)
- [ ] Alarm auto-resolves when condition clears
- [ ] Alarm auto-resolves when threshold changed
- [ ] Alarm auto-resolves when definition deleted
- [ ] `not_reporting` resolves when device reconnects
- [ ] `LOGGING_HIGH_DRIFT` resolves after 3 healthy checks

---

## 9. Key Code Locations

| Feature | File | Function/Line |
|---------|------|---------------|
| Alarm evaluation | `alarm_evaluator.py` | `evaluate()` returns `(triggered, active_conditions)` |
| Condition-clear auto-resolve | `service.py` | `_evaluate_alarms()` uses `active_conditions` |
| Config-change re-evaluation | `service.py` | `_reevaluate_alarms_after_config_change()` |
| Cloud dedup check | `service.py` | `_process_alarm()` for critical/major |
| Skip resolution sync for reg_* | `cloud_sync.py` | `sync_resolved_alarms()` |
| Cloud unresolved check | `cloud_sync.py` | `check_unresolved_alarm()` |
| Local dedup check | `local_db.py` | `has_unresolved_alarm()` |
| Bulk resolve by type | `local_db.py` | `resolve_alarms_by_type()` (no synced_at reset) |
| Orphan resolution | `service.py` | `_config_watch_loop()` |
| Device readings sampling | `service.py` | `_sample_callback()` only place alarms evaluated |

---

## 10. Related Skills

- **`check-controller`**: Service health, SharedState, config sync
- **`check-logging`**: Data flow, SQLite, cloud sync, downsampling

<!-- Created: 2026-01-30 -->
