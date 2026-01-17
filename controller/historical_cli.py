#!/usr/bin/env python3
"""
Historical Data CLI

Query local SQLite database for historical device readings.
Used by the backend to fetch local data via SSH.

Usage:
    python historical_cli.py query --site-id UUID --start 2026-01-10T00:00:00 --end 2026-01-17T23:59:59

Output: JSON to stdout
"""

import argparse
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path


DB_PATH = "/data/controller.db"


def get_connection() -> sqlite3.Connection:
    """Get database connection with row factory."""
    if not Path(DB_PATH).exists():
        print(json.dumps({
            "success": False,
            "error": f"Database not found at {DB_PATH}"
        }))
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def query_historical(
    site_id: str,
    device_ids: list[str] | None,
    registers: list[str] | None,
    start: str,
    end: str,
    limit: int = 50000
) -> dict:
    """
    Query historical device readings from local SQLite.

    Args:
        site_id: Site UUID
        device_ids: Optional list of device UUIDs to filter
        registers: Optional list of register names to filter
        start: Start datetime (ISO format)
        end: End datetime (ISO format)
        limit: Max records to return

    Returns:
        JSON-serializable dict with readings grouped by device/register
    """
    try:
        conn = get_connection()

        # Build query
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
        rows = cursor.fetchall()
        conn.close()

        # Group by device_id and register_name
        grouped: dict[str, dict] = {}

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

        return {
            "success": True,
            "deviceReadings": list(grouped.values()),
            "metadata": {
                "totalPoints": len(rows),
                "startTime": start,
                "endTime": end,
                "source": "local"
            }
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


def main():
    parser = argparse.ArgumentParser(description="Query local historical data")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Query command
    query_parser = subparsers.add_parser("query", help="Query historical readings")
    query_parser.add_argument("--site-id", required=True, help="Site UUID")
    query_parser.add_argument("--device-ids", help="Comma-separated device UUIDs")
    query_parser.add_argument("--registers", help="Comma-separated register names")
    query_parser.add_argument("--start", required=True, help="Start datetime (ISO)")
    query_parser.add_argument("--end", required=True, help="End datetime (ISO)")
    query_parser.add_argument("--limit", type=int, default=50000, help="Max records")

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
            limit=args.limit
        )

        print(json.dumps(result))


if __name__ == "__main__":
    main()
