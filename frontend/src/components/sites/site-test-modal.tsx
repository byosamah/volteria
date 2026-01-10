"use client";

/**
 * Site Test Modal Component
 *
 * Displays a modal for running quick diagnostic tests on a site.
 * Shows real-time progress as each device is tested.
 */

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  Play,
  RefreshCw,
} from "lucide-react";

// Test result for a single device or check
interface TestResult {
  device_id: string | null;
  device_name: string;
  device_type: string;
  brand: string;
  model: string;
  status: "pending" | "running" | "passed" | "failed";
  message: string | null;
  value: number | null;
}

// Full test record from database
interface TestRecord {
  id: string;
  site_id: string;
  triggered_by: string | null;
  started_at: string;
  completed_at: string | null;
  status: "running" | "passed" | "failed" | "partial";
  results: TestResult[];
  created_at: string;
}

interface SiteTestModalProps {
  siteId: string;
  siteName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SiteTestModal({
  siteId,
  siteName,
  open,
  onOpenChange,
}: SiteTestModalProps) {
  const [testRecord, setTestRecord] = useState<TestRecord | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start a new test
  const startTest = async () => {
    setIsStarting(true);
    setError(null);

    try {
      const response = await fetch(`/api/sites/${siteId}/test`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to start test");
      }

      const data = await response.json();

      // V1: Test completes immediately, fetch results
      const testResponse = await fetch(`/api/sites/${siteId}/test?testId=${data.test_id}`);
      if (testResponse.ok) {
        const testData: TestRecord = await testResponse.json();
        setTestRecord(testData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start test");
    } finally {
      setIsStarting(false);
    }
  };

  // Fetch latest test when modal opens
  useEffect(() => {
    if (open) {
      fetch(`/api/sites/${siteId}/test`)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.id) {
            setTestRecord(data);
          }
        })
        .catch(() => {
          // No previous test, that's fine
        });
    }
  }, [open, siteId]);

  // Get status icon for a test result
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "passed":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-red-500" />;
      case "running":
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
      default:
        return <Circle className="h-5 w-5 text-muted-foreground" />;
    }
  };

  // Get device type label
  const getDeviceTypeLabel = (type: string) => {
    switch (type) {
      case "load_meter":
        return "Load Meter";
      case "inverter":
        return "Inverter";
      case "dg":
        return "Generator Controller";
      case "control_logic":
        return "Control Logic";
      default:
        return type;
    }
  };

  // Calculate progress
  const completedTests = testRecord?.results.filter(
    (r) => r.status === "passed" || r.status === "failed"
  ).length || 0;
  const totalTests = testRecord?.results.length || 0;

  // Overall status badge
  const getStatusBadge = () => {
    if (!testRecord) return null;

    switch (testRecord.status) {
      case "running":
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            Running ({completedTests}/{totalTests})
          </Badge>
        );
      case "passed":
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            All Passed
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
            Failed
          </Badge>
        );
      case "partial":
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
            Partial Success
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            Site Diagnostics
            {getStatusBadge()}
          </DialogTitle>
          <DialogDescription>
            Test device communication and control logic for {siteName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Error display */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {/* No test yet */}
          {!testRecord && !isStarting && (
            <div className="py-8 text-center text-muted-foreground">
              <p className="mb-4">Run a quick test to verify all devices are communicating correctly.</p>
              <Button onClick={startTest}>
                <Play className="mr-2 h-4 w-4" />
                Run Test
              </Button>
            </div>
          )}

          {/* Test results */}
          {testRecord && (
            <>
              <div className="border rounded-lg divide-y">
                {testRecord.results.map((result, index) => (
                  <div
                    key={result.device_id || index}
                    className="p-3 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      {getStatusIcon(result.status)}
                      <div>
                        <div className="font-medium text-sm">
                          {result.device_name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {getDeviceTypeLabel(result.device_type)}
                          {result.brand && result.model && (
                            <> &middot; {result.brand} {result.model}</>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      {result.status === "passed" && result.value !== null && (
                        <span className="text-sm font-medium text-green-600">
                          {result.value.toFixed(1)} kW
                        </span>
                      )}
                      {result.status === "failed" && result.message && (
                        <span className="text-xs text-red-600">
                          {result.message}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Test metadata */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Started: {new Date(testRecord.started_at).toLocaleTimeString()}
                </span>
                {testRecord.completed_at && (
                  <span>
                    Completed: {new Date(testRecord.completed_at).toLocaleTimeString()}
                  </span>
                )}
              </div>

              {/* Run again button */}
              {testRecord.status !== "running" && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    onClick={startTest}
                    disabled={isStarting}
                  >
                    {isStarting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Run Again
                  </Button>
                </div>
              )}
            </>
          )}

          {/* Starting state */}
          {isStarting && !testRecord && (
            <div className="py-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">Starting test...</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
