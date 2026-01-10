/**
 * Export Data Button Component
 *
 * ⚠️ PHASE 4 - Reporting & Analytics
 *
 * Exports project data to CSV format:
 * - Date range selection
 * - Progress indicator during export
 * - Automatic file download
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, Loader2, FileSpreadsheet, Calendar } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Props for the ExportDataButton
interface ExportDataButtonProps {
  projectId: string;
}

// Export range options
type ExportRange = "7d" | "30d" | "90d" | "all";

export function ExportDataButton({ projectId }: ExportDataButtonProps) {
  const [exporting, setExporting] = useState(false);
  const [exportRange, setExportRange] = useState<ExportRange | null>(null);

  // Handle export
  async function handleExport(range: ExportRange) {
    setExporting(true);
    setExportRange(range);

    try {
      const supabase = createClient();

      // Calculate date range
      let startDate: Date | null = null;
      const now = new Date();

      switch (range) {
        case "7d":
          startDate = new Date(now);
          startDate.setDate(now.getDate() - 7);
          break;
        case "30d":
          startDate = new Date(now);
          startDate.setDate(now.getDate() - 30);
          break;
        case "90d":
          startDate = new Date(now);
          startDate.setDate(now.getDate() - 90);
          break;
        case "all":
          startDate = null;
          break;
      }

      // Build query
      let query = supabase
        .from("control_logs")
        .select("timestamp, total_load_kw, solar_output_kw, dg_power_kw, solar_limit_pct, safe_mode_active, config_mode")
        .eq("project_id", projectId)
        .order("timestamp", { ascending: true });

      if (startDate) {
        query = query.gte("timestamp", startDate.toISOString());
      }

      const { data: logs, error } = await query.limit(10000);

      if (error) {
        console.error("Export failed:", error);
        alert("Failed to export data. Please try again.");
        return;
      }

      if (!logs || logs.length === 0) {
        alert("No data available for the selected period.");
        return;
      }

      // Convert to CSV
      const headers = [
        "Timestamp",
        "Total Load (kW)",
        "Solar Output (kW)",
        "Generator Power (kW)",
        "Solar Limit (%)",
        "Safe Mode Active",
        "Config Mode",
      ];

      const csvRows = [
        headers.join(","),
        ...logs.map((log) =>
          [
            new Date(log.timestamp).toISOString(),
            log.total_load_kw?.toFixed(2) || "0",
            log.solar_output_kw?.toFixed(2) || "0",
            log.dg_power_kw?.toFixed(2) || "0",
            log.solar_limit_pct?.toString() || "0",
            log.safe_mode_active ? "Yes" : "No",
            log.config_mode || "unknown",
          ].join(",")
        ),
      ];

      const csvContent = csvRows.join("\n");

      // Create and trigger download
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);

      // Generate filename with date range
      const dateStr = new Date().toISOString().split("T")[0];
      const rangeLabel = range === "all" ? "all-time" : `last-${range}`;
      link.setAttribute("download", `power-data-${rangeLabel}-${dateStr}.csv`);

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
      alert("An error occurred during export.");
    } finally {
      setExporting(false);
      setExportRange(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="min-h-[44px] gap-2"
          disabled={exporting}
        >
          {exporting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              Export Data
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Export as CSV
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => handleExport("7d")}
          className="min-h-[44px] cursor-pointer"
        >
          <Calendar className="h-4 w-4 mr-2" />
          Last 7 days
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleExport("30d")}
          className="min-h-[44px] cursor-pointer"
        >
          <Calendar className="h-4 w-4 mr-2" />
          Last 30 days
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleExport("90d")}
          className="min-h-[44px] cursor-pointer"
        >
          <Calendar className="h-4 w-4 mr-2" />
          Last 90 days
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => handleExport("all")}
          className="min-h-[44px] cursor-pointer"
        >
          <Download className="h-4 w-4 mr-2" />
          All data
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
