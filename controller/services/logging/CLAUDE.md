# Logging Service - CLAUDE.md

## Purpose
Layer 5 of controller architecture. Handles:
- Local data buffering (RAM -> SQLite)
- Cloud sync with per-register downsampling
- Alarm evaluation and threshold checking

## Architecture (3-Tier with RAM Buffer)

```
Device Service -> SharedState (raw readings every ~1s)
       |
RAM BUFFER (sample every 1s, max 10,000 readings)
       |
LOCAL SQLITE (flush every 60s)
       |
CLOUD SYNC (every 180s, downsampled per-register)
```

## Key Files
| File | Lines | Purpose |
|------|-------|---------|
| service.py | ~900 | Main orchestration, schedulers, sampling |
| local_db.py | ~300 | SQLite operations, tables, queries |
| cloud_sync.py | ~500 | Supabase upload, retry, on_conflict |
| alarm_evaluator.py | ~200 | Threshold checking |

## Configuration
| Setting | Default | Source | Description |
|---------|---------|--------|-------------|
| local_sample_interval_s | 1s | Code | Sample from SharedState |
| local_flush_interval_s | 60s | Code | Flush RAM to SQLite |
| cloud_sync_interval_s | 180s | Code | Sync to Supabase |
| logging_frequency | per-register | Config | Cloud downsampling (1-3600s) |

## Per-Register Downsampling

Each register has its own `logging_frequency` in seconds:
- **1s**: Every reading sent to cloud
- **60s**: 1 reading per minute (default)
- **900s**: 1 reading per 15 minutes
- **3600s**: 1 reading per hour

Local SQLite keeps FULL 1s resolution. Cloud receives downsampled data.

## Clock-Aligned Bucket Selection

Timestamps are aligned to frequency boundaries:

```python
bucket = int(ts // frequency_seconds) * frequency_seconds
```

| Frequency | Boundaries |
|-----------|------------|
| 60s | :00, :01, :02... |
| 300s | :00, :05, :10... |
| 900s | :00, :15, :30, :45 |
| 3600s | 00:00, 01:00, 02:00... |

## PostgREST on_conflict (CRITICAL)

**The Bug** (fixed 2026-01-20): Cloud sync returned 409 even for new records.

**Root Cause**: `Prefer: resolution=ignore-duplicates` needs explicit `on_conflict` columns. Without it, entire batch fails if ANY record is duplicate.

**The Fix**:
```python
url = f"{supabase_url}/rest/v1/{table}?on_conflict=device_id,register_name,timestamp"
```

**Conflict columns**:
- `device_readings`: device_id,register_name,timestamp
- `control_logs`: site_id,timestamp
- `alarms`: site_id,alarm_type,timestamp

## Robustness Patterns

1. **Upload-then-mark**: Only mark readings synced AFTER successful upload
2. **Empty batch handling**: Don't mark synced if downsampling filtered all records
3. **409 Conflict**: Treat as success (duplicates already exist)
4. **Retry with backoff**: 1s, 2s, 4s delays on failure
5. **Backfill progress**: Log progress when >1000 readings pending

## Debugging Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/logging-stats` | GET | Buffer size, timing drift, error counts |
| `/logging-debug` | GET | Detailed internal state + diagnostics |
| `/api/controllers/{id}/logs` | POST | Fetch journalctl logs via SSH |

## Health Check (port 8085)

```bash
curl localhost:8085/stats
```

Returns:
```json
{
  "buffer": {"readings_count": 30, "memory_kb": 9.0},
  "timing": {"sample_drift_ms": 0.3, "flush_drift_ms": 1.2},
  "schedulers": {"sample": {"execution_count": 762, "skipped_count": 0}},
  "errors": {"sample_errors": 0, "flush_errors": 0, "cloud_errors": 0}
}
```

## Debug Endpoint (Enhanced)

```bash
curl localhost:8085/debug
```

Returns diagnostics section:
```json
{
  "diagnostics": {
    "config_hash": "a1b2c3d4",
    "config_last_change": "2026-01-20T15:00:00Z",
    "devices_by_type": {"sensors": 2, "inverters": 1},
    "registers_by_frequency": {"1s": 3, "60s": 10, "900s": 2},
    "frequency_lookup_misses": 0,
    "buffer_current": 45,
    "buffer_peak_24h": 500,
    "clock_buckets_created": 1440,
    "clock_duplicates_skipped": 5
  }
}
```

## Log Prefixes (for filtering)

| Prefix | Meaning | Frequency |
|--------|---------|-----------|
| `[HEALTH]` | 10-min health summary | 6/hour |
| `[CLOUD]` | Cloud sync summary | ~20/hour |
| `[CONFIG]` | Config change details | On change |
| `[FREQ]` | Frequency lookup issues | On issue (max 10) |
| `[ERROR]` | Error with full details | On error |

**Filter commands:**
```bash
journalctl -u volteria -f | grep -E '\[(HEALTH|CLOUD|CONFIG|FREQ|ERROR)\]'
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| 409 batch failures | Missing on_conflict param | Add ?on_conflict=... to URL |
| Data gaps after restart | Old timestamps re-synced | Clock alignment handles this |
| Readings not appearing | SharedState name mismatch | Log what device wrote, not config |
| Wrong logging frequency | Devices dict iteration bug | Flatten dict before extracting freqs |
