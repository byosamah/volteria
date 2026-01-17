#!/usr/bin/env python3
"""
Historical Data CLI

Query local SQLite database for historical device readings.
Used by the backend to fetch local data via SSH.

Safety features:
- Read-only database access (URI mode=ro)
- Conservative query limit (max 10,000 records)
- Short busy timeout to avoid blocking control loop
- Row-by-row processing to limit memory usage
- Graceful handling of database busy errors
- Lower process priority (nice)

Usage:
    python historical_cli.py query --site-id UUID --start 2026-01-10T00:00:00 --end 2026-01-17T23:59:59

Output: JSON to stdout
"""

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path


DB_PATH = "/opt/volteria/data/controller.db"

# Conservative limits to protect controller performance
MAX_RECORDS = 10000      # Hard limit on query results
BUSY_TIMEOUT_MS = 1000   # 1 second - fail fast if DB busy
FETCH_CHUNK_SIZE = 1000  # Process in chunks to limit memory


def set_low_priority():
    """Lower process priority to avoid impacting control loop."""
    try:
        os.nice(10)  # Lower priority (higher nice value = lower priority)
    except (OSError, AttributeError):
        pass  # Ignore if not supported (Windows)


def get_connection() -> sqlite3.Connection:
    """Get read-only database connection with conservative settings."""
    if not Path(DB_PATH).exists():
        raise FileNotFoundError(f"Database not found at {DB_PATH}")

    # Open in read-only mode using URI with immutable flag
    # immutable=1 tells SQLite to skip journal file checks (safe for read-only)
    conn = sqlite3.connect(
        f"file:{DB_PATH}?mode=ro&immutable=1",
        uri=True,
        timeout=BUSY_TIMEOUT_MS / 1000.0,  # Convert to seconds
        isolation_level=None  # Autocommit (no transaction for reads)
    )
    conn.row_factory = sqlite3.Row

    # Use query_only mode as extra safety (won't write even if bug)
    try:
        conn.execute("PRAGMA query_only = ON")
    except sqlite3.OperationalError:
        pass  # Older SQLite versions may not support this

    return conn


def query_historical(
    site_id: str,
    device_ids: list[str] | None,
    registers: list[str] | None,
    start: str,
    end: str,
    limit: int = MAX_RECORDS
) -> dict:
    """
    Query historical device readings from local SQLite.

    Designed to be non-blocking and memory-efficient.
    Will fail fast if database is busy rather than blocking control operations.

    Args:
        site_id: Site UUID
        device_ids: Optional list of device UUIDs to filter
        registers: Optional list of register names to filter
        start: Start datetime (ISO format)
        end: End datetime (ISO format)
        limit: Max records to return (capped at MAX_RECORDS)

    Returns:
        JSON-serializable dict with readings grouped by device/register
    """
    # Enforce hard limit to protect memory
    limit = min(limit, MAX_RECORDS)

    conn = None
    try:
        conn = get_connection()

        # Build query with parameterized inputs
        sql = """
            SELECT
                device_id,
                register_name,
                timestamp,
                value,
                unit
            FROM device_readings
            WHERE site_id = ?
              AND timestamp >= ?
              AND timestamp <= ?
        """
        params: list = [site_id, start, end]

        # Add device filter
        if device_ids:
            placeholders = ",".join("?" * len(device_ids))
            sql += f" AND device_id IN ({placeholders})"
            params.extend(device_ids)

        # Add register filter
        if registers:
            placeholders = ",".join("?" * len(registers))
            sql += f" AND register_name IN ({placeholders})"
            params.extend(registers)

        sql += " ORDER BY timestamp ASC LIMIT ?"
        params.append(limit)

        cursor = conn.execute(sql, params)

        # Process rows in chunks to limit memory usage
        grouped: dict[str, dict] = {}
        total_points = 0

        while True:
            rows = cursor.fetchmany(FETCH_CHUNK_SIZE)
            if not rows:
                break

            for row in rows:
                device_id = row["device_id"]
                register_name = row["register_name"]
                key = f"{device_id}:{register_name}"

                if key not in grouped:
                    grouped[key] = {
                        "device_id": device_id,
                        "register_name": register_name,
                        "unit": row["unit"],
                        "data": []
                    }

                grouped[key]["data"].append({
                    "timestamp": row["timestamp"],
                    "value": row["value"]
                })
                total_points += 1

        return {
            "success": True,
            "deviceReadings": list(grouped.values()),
            "metadata": {
                "totalPoints": total_points,
                "startTime": start,
                "endTime": end,
                "source": "local",
                "limitApplied": total_points >= limit
            }
        }

    except FileNotFoundError as e:
        return {
            "success": False,
            "error": str(e)
        }
    except sqlite3.OperationalError as e:
        error_msg = str(e).lower()
        if "locked" in error_msg or "busy" in error_msg:
            return {
                "success": False,
                "error": "Database busy - control loop is running. Try again shortly."
            }
        return {
            "success": False,
            "error": f"Database error: {str(e)}"
        }
    except sqlite3.Error as e:
        return {
            "success": False,
            "error": f"Database error: {str(e)}"
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Query failed: {str(e)}"
        }
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def main():
    # Lower priority before doing anything
    set_low_priority()

    parser = argparse.ArgumentParser(description="Query local historical data (read-only)")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Query command
    query_parser = subparsers.add_parser("query", help="Query historical readings")
    query_parser.add_argument("--site-id", required=True, help="Site UUID")
    query_parser.add_argument("--device-ids", help="Comma-separated device UUIDs")
    query_parser.add_argument("--registers", help="Comma-separated register names")
    query_parser.add_argument("--start", required=True, help="Start datetime (ISO)")
    query_parser.add_argument("--end", required=True, help="End datetime (ISO)")
    query_parser.add_argument("--limit", type=int, default=MAX_RECORDS, help=f"Max records (max {MAX_RECORDS})")

    args = parser.parse_args()

    if args.command == "query":
        device_ids = args.device_ids.split(",") if args.device_ids else None
        registers = args.registers.split(",") if args.registers else None

        result = query_historical(
            site_id=args.site_id,
            device_ids=device_ids,
            registers=registers,
            start=args.start,
            end=args.end,
            limit=min(args.limit, MAX_RECORDS)  # Enforce limit
        )

        print(json.dumps(result))


if __name__ == "__main__":
    main()
