# Check Logging - Volteria Logging Service Reference

> Master reference for the logging service: architecture, validation, diagnostics, and intended design.

## Trigger Conditions

Activate this skill when:
- Files touched: `controller/services/logging/*`, `controller/services/device/register_reader.py`, `controller/common/scheduler.py`, `controller/common/timestamp.py`
- Topics: logging frequency, cloud sync, device readings, downsampling, data gaps, SQLite buffer, alarm evaluation

---

## 1. Architecture Reference (Current State)

### Data Flow

```
Device (Modbus) → RegisterReader → SharedState (readings.json)
        ↓
   RAM Buffer (sample every 1s, max 10,000 readings)
        ↓
   SQLite (flush every 60s, WAL mode)
        ↓
   Cloud Sync (every 180s, per-register downsampling)
        ↓
   Supabase (device_readings, control_logs, alarms)
```

### Timing

| Stage | Interval | Purpose |
|-------|----------|---------|
| Sample | 1s (`local_sample_interval_s`) | Read SharedState → RAM buffer |
| Flush | 60s (`local_flush_interval_s`) | RAM → SQLite batch write |
| Cloud Sync | 180s (`cloud_sync_interval_s`) | SQLite → Supabase (downsampled) |
| Per-register | `logging_frequency` (default 60s) | Controls cloud data density |

### Clock-Aligned Downsampling

Per-register `logging_frequency` determines how many readings reach the cloud:
- All readings stored locally (1s intervals)
- Cloud sync selects ONE reading per clock-aligned bucket
- Bucket: `int(timestamp // frequency) * frequency`
- Example: 60s frequency → 1 reading/minute → 1440/day

### Key Files

| File | Purpose |
|------|---------|
| `controller/services/logging/service.py` | Main orchestration (1415 lines) |
| `controller/services/logging/local_db.py` | SQLite storage (549 lines) |
| `controller/services/logging/cloud_sync.py` | Supabase upload (532 lines) |
| `controller/services/logging/alarm_evaluator.py` | Threshold checking (218 lines) |
| `controller/common/scheduler.py` | Precise timing loops (225 lines) |
| `controller/common/timestamp.py` | Clock alignment utilities (117 lines) |
| `controller/common/state.py` | SharedState atomic file I/O |
| `controller/services/device/register_reader.py` | Modbus polling (235 lines) |

### Function Map

**service.py (LoggingService)**:
- `_run_db()` :167 - Thread pool wrapper for SQLite (CRITICAL: never call local_db directly)
- `start()` :187 - Start all schedulers & tasks
- `_sample_callback()` :440 - ScheduledLoop: sample SharedState → RAM
- `_flush_callback()` :462 - ScheduledLoop: flush RAM → SQLite
- `_cloud_sync_loop()` :686 - Background: periodic cloud upload
- `_sync_device_readings_filtered()` :734 - Apply per-register downsampling
- `_downsample_readings()` :914 - Clock-aligned bucket selection
- `_write_control_log_summary()` :1079 - Aggregate control state (delta filter)
- `_evaluate_alarms()` :1183 - Check threshold conditions
- `_start_health_server()` :1317 - HTTP on port 8085
- `ALERT_DRIFT_MS = 5000` :53 - Drift threshold for alarm (raised from 1000ms)

**local_db.py (LocalDatabase)**:
- `resolve_alarms_by_type()` :283 - Bulk resolve + resync to cloud
- `cleanup_old_data()` :363 - Retention-based deletion
- `insert_device_readings_batch()` :470 - Batch insert with retry [0.5s, 1s, 2s]
- `get_unsynced_device_readings()` :540 - Fetch pending (limit 100)
- `get_unsynced_device_readings_newest()` :555 - Fetch newest (limit 5000, backfill phase 1)
- `get_unsynced_device_readings_count()` :570 - Count pending readings
- `mark_device_readings_synced()` :577 - Mark after successful upload

**cloud_sync.py (CloudSync)**:
- `sync_specific_readings()` :263 - Sync downsampled readings
- `_upload_with_retry()` :403 - HTTP POST with retry & 409 handling
- `sync_alarm_immediately()` :509 - Critical alarms bypass delay

**alarm_evaluator.py (AlarmEvaluator)**:
- `evaluate()` :67 - Check all alarm conditions against readings
- `_check_condition()` :176 - Operators: >, >=, <, <=, ==, !=
- Source types: `modbus_register`, `device_info`, `calculated_field`, `heartbeat`

**scheduler.py (ScheduledLoop)**:
- `_run()` :94 - Wall-clock precision loop with drift tracking
- Aligns first run to next interval boundary
- Skips missed intervals if callback overruns

**timestamp.py**:
- `align_timestamp()` :16 - Align datetime to interval boundary
- `get_aligned_now_iso()` :106 - Current UTC aligned as ISO string

### Config Flow

```
Templates (Supabase) → site_devices → config sync (Layer 2)
    → SharedState config.json → LoggingService reads on each sync cycle
    → Per-register logging_frequency applied during downsampling
```

### Smart Backfill (Offline Recovery)

When controller comes back online with >1,000 pending readings:

**Two-Phase Strategy**:
1. **RECENT_FIRST**: Sync newest 5,000 readings → dashboard shows current state in ~30s
2. **FILLING_GAPS**: Sync remaining oldest-first → fill historical gaps

**Accelerated Catch-Up**: Sync interval drops from 180s → 30s during backfill (6x faster)

**Source Tracking**: `device_readings.source` column:
- `live` — real-time sync (normal operation)
- `backfill` — recovered after offline period

**BackfillPhase** states: `NORMAL` → `RECENT_FIRST` → `FILLING_GAPS` → `NORMAL`

**Key files**:
- `cloud_sync.py`: `BackfillPhase` enum, `BackfillTracker` dataclass
- `service.py`: Two-phase logic in `_sync_device_readings_filtered()`
- `local_db.py`: `get_unsynced_device_readings_newest()`, `get_unsynced_device_readings_count()`

---

## 2. Intended Design (Not Yet Implemented)

### Data Quality Alarms (per-device, configurable on frontend)
- **Stale data**: Register value unchanged for X minutes
- **Out of range**: Value exceeds register min/max (from template definition)
- **Read timeouts**: Device responds but specific register fails repeatedly
- **Communication quality**: Track success rate over rolling window

### Controller-Level Alarms
- Beyond device-level: controller health events
- Disk space warnings (SQLite growth)
- Memory pressure (buffer approaching cap)
- Network quality (cloud sync latency trends)

### Cloud Ingestion Evolution
- Current: Direct Supabase REST API from controller (keep for now)
- Future option: Backend API layer for validation/analytics/rate-limiting
- Future option: Batch compression for bandwidth optimization

---

## 3. Validation Rules

When modifying logging code, verify these invariants:

| Rule | Why |
|------|-----|
| Never cache `logging_frequency` | Config can change at any time via cloud sync |
| Upload-then-mark pattern | Never mark synced before upload succeeds (cloud_sync.py:403) |
| Clock-aligned timestamps | Cross-device correlation requires identical bucket boundaries |
| Stale reading deletion on device failure | Intentional gaps, not stale data (device_manager) |
| `on_conflict` parameter required | Supabase upserts need conflict columns specified |
| SQLite WAL mode | Concurrent read/write without blocking |
| Buffer overflow cap: 10,000 readings | Prevent OOM on Raspberry Pi (~2-3MB) |
| Min `logging_frequency` = 1s | Below 1s causes scheduler overload |
| Default `logging_frequency` = 60s | Reasonable cloud data density |
| Atomic file writes (SharedState) | Temp → fsync → rename prevents corruption |
| asyncio.Lock for RAM buffer | Concurrent sample/flush safety |
| Delta filter for control logs | Skip if <1% change (service.py:1079) |
| Retry backoff for SQLite | [0.5s, 1s, 2s], max 3 attempts |
| 409 = success for cloud sync | Duplicate already exists in Supabase |
| Fresh config read each sync cycle | service.py:734 - no stale frequency data |
| All local_db calls via `_run_db()` | Never block asyncio event loop (service.py:167) |
| ALERT_DRIFT_MS = 5000ms | Realistic for Pi SD card I/O (raised from 1000ms) |
| Drift alarms auto-resolve after 3 healthy checks | Prevent alarm spam for transient I/O spikes |

---

## 4. Diagnostic Protocol

### Health Server (Port 8085)

| Endpoint | Returns |
|----------|---------|
| `GET /health` | status, service name, uptime, timestamp |
| `GET /stats` | database stats, buffer stats, timing, scheduler metrics, error counts |
| `GET /debug` | register frequencies, downsample results, diagnostics |

### Backend Debug Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/api/controllers/{id}/logging-debug` | Buffer stats, frequency misses, clock buckets |
| `/api/controllers/{id}/logging-stats` | Timing metrics, scheduler drift |

### Diagnostic Checks

| Check | Condition | Meaning |
|-------|-----------|---------|
| `frequency_lookup_misses > 0` | Registers missing frequency config | Config sync issue or new registers |
| `buffer_peak_24h` high | Flush or sync failing | Check disk/network errors |
| `cloud_errors > 0` | Connectivity or auth issues | Check Supabase credentials/network |
| `sample_drift_ms > 100` | Scheduler precision degrading | CPU overload or blocking I/O |
| `flush_errors > 0` | SQLite write failures | Disk full or permission issues |
| `unsynced_device_readings` growing | Cloud sync not keeping up | Network issues or high data volume |
| `db_size_bytes` growing unbounded | Cleanup not running | Check retention config |
| `backfill_phase = recent` | First sync after reconnect | Syncing newest data for dashboard |
| `backfill_phase = filling` | Filling gaps after reconnect | Working through older data |
| `backfill_phase = normal` | No backfill active | Healthy state |

### Diagnostic Workflow

1. **SSH to controller**: Check health endpoint first
   ```bash
   curl http://localhost:8085/health
   curl http://localhost:8085/stats
   curl http://localhost:8085/debug
   ```

2. **Check SQLite directly** (if health server down):
   ```bash
   sqlite3 /opt/volteria/data/controller.db "SELECT COUNT(*) FROM device_readings WHERE synced_at IS NULL"
   ```

3. **Check SharedState**:
   ```bash
   cat /opt/volteria/data/state/readings.json | python3 -m json.tool
   cat /opt/volteria/data/state/config.json | python3 -m json.tool | grep logging_frequency
   ```

4. **Check service logs**:
   ```bash
   journalctl -u volteria-logging --since "1 hour ago" | grep -i error
   ```

---

## 5. API & DB Reference

### Cloud Tables

| Table | Unique Constraint | Purpose |
|-------|-------------------|---------|
| `device_readings` | `(device_id, register_name, timestamp)` | Per-register time-series |
| `control_logs` | `(site_id, timestamp)` | Aggregated control state |
| `alarms` | `(site_id, alarm_type, timestamp)` | System events |

### Backend Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/logs/site/{site_id}/push` | POST | Controller uploads control logs |
| `/api/logs/{project_id}` | GET | Query logs by time range |
| `/api/logs/{project_id}/stats` | GET | Aggregate statistics |
| `/api/logs/{project_id}/export` | GET | Download CSV/JSON |
| `/api/alarms/site/{site_id}` | POST | Controller creates alarm |
| `/api/alarms/{project_id}` | GET | List project alarms |
| `/api/alarms/{project_id}/{id}/acknowledge` | POST | Acknowledge alarm |
| `/api/alarms/{project_id}/{id}/resolve` | POST | Resolve alarm |

### Alarm Types
`communication_lost`, `control_error`, `safe_mode_triggered`, `not_reporting`, `controller_offline`, `write_failed`, `command_not_taken`

### Severity Levels
`info`, `warning`, `major`, `critical`

### SQLite Schema (controller-side)

```sql
-- device_readings
CREATE TABLE device_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    register_name TEXT NOT NULL,
    value REAL,
    unit TEXT,
    timestamp TEXT NOT NULL,
    synced_at TEXT
);
CREATE INDEX idx_device_readings_unsynced ON device_readings(synced_at) WHERE synced_at IS NULL;

-- control_logs
CREATE TABLE control_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    site_id TEXT NOT NULL,
    total_load_kw REAL,
    solar_output_kw REAL,
    dg_power_kw REAL,
    safe_mode_active INTEGER DEFAULT 0,
    synced_at TEXT
);

-- alarms
CREATE TABLE alarms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alarm_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    alarm_type TEXT NOT NULL,
    severity TEXT DEFAULT 'warning',
    message TEXT,
    timestamp TEXT NOT NULL,
    acknowledged INTEGER DEFAULT 0,
    resolved INTEGER DEFAULT 0,
    synced_at TEXT
);
```

### SQLite Pragmas (Disk-Wear Optimization)
```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;
PRAGMA cache_size=-2000;  -- 2MB
```

---

## 6. Observability Metrics

### LoggingService Metrics (service.py)
- `_sample_error_count` :113 - Sample failures
- `_flush_error_count` :114 - Flush failures
- `_cloud_error_count` :115 - Cloud sync failures
- `_sample_drift_ms` :118 - Scheduler timing drift
- `_flush_drift_ms` :119 - Flush timing drift
- `_buffer_peak_24h` :139 - Peak buffer size in 24h
- `ALERT_DRIFT_MS = 5000` :53 - Drift alarm threshold (5s)

### Drift Alarm Auto-Resolve
- LOGGING_HIGH_DRIFT alarms auto-resolve after 3 consecutive healthy checks
- Uses `local_db.resolve_alarms_by_type("LOGGING_HIGH_DRIFT")` :283
- Prevents alarm spam for conditions that self-heal (SD card I/O spikes)

### Thread Pool Pattern (CRITICAL)
All `local_db.*` calls from async code MUST use:
```python
await self._run_db(self._local_db.method_name, arg1, arg2)
```
- Wraps synchronous sqlite3 in `run_in_executor` (thread pool)
- Without this: 15-22s event loop stalls on Pi SD card I/O
- Location: `service.py` :167

### CloudSync Metrics
- `BATCH_SIZE = 100` - Records per upload
- `RETRY_BACKOFF = [1, 2, 4]` - Seconds between retries
- `BACKFILL_THRESHOLD = 1000` - Triggers backfill mode
- Backfill progress logged every 1000 records

### ScheduledLoop Metrics
- `_drift_total` - Cumulative drift in seconds
- `_skipped_count` - Missed intervals
- `_execution_count` - Successful runs
- `_last_drift_ms` - Most recent drift
