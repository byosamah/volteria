"""
Run the database schema on Supabase.

This script uses the Supabase Python client to execute the schema.
"""

import os
from supabase import create_client, Client

# Supabase credentials
SUPABASE_URL = "https://usgxhzdctzthcqxyxfxl.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzZ3hoemRjdHp0aGNxeHl4ZnhsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTAwOTQ2MywiZXhwIjoyMDgwNTg1NDYzfQ.4iKrB2pv7OVaKv_VY7QoyWQzSPuALcNPNJnD5S3Z74I"

def main():
    # Create Supabase client
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("Connected to Supabase!")
    print(f"URL: {SUPABASE_URL}")

    # Test by inserting a device template
    print("\nTesting database connection by querying device_templates...")

    try:
        result = supabase.table("device_templates").select("*").execute()
        print(f"Found {len(result.data)} device templates")
        for t in result.data:
            print(f"  - {t.get('name', 'Unknown')}")
    except Exception as e:
        print(f"Tables might not exist yet: {e}")
        print("\n⚠️  Please run the schema.sql file in the Supabase SQL Editor:")
        print("   1. Go to https://supabase.com/dashboard/project/usgxhzdctzthcqxyxfxl/sql")
        print("   2. Open database/schema.sql")
        print("   3. Copy and paste the SQL into the editor")
        print("   4. Click 'Run'")

if __name__ == "__main__":
    main()
