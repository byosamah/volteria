/**
 * Control Page Loading State
 *
 * Shows skeleton UI while control panel data is loading.
 */

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ControlLoading() {
  return (
    <DashboardLayout user={{}}>
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header skeleton */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <Skeleton className="h-8 w-48 mb-2" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-8 w-32" />
          </div>
        </div>

        {/* Control panels skeleton */}
        <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
          {/* Remote Control Panel */}
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-32 mb-2" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Power limit slider */}
              <div className="space-y-4">
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-8 w-16" />
                </div>
                <Skeleton className="h-2 w-full" />
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-11 w-14" />
                  ))}
                </div>
                <Skeleton className="h-11 w-full" />
              </div>

              <Skeleton className="h-px w-full" />

              {/* DG Reserve */}
              <div className="space-y-4">
                <Skeleton className="h-4 w-24" />
                <div className="flex gap-2">
                  <Skeleton className="h-11 flex-1" />
                  <Skeleton className="h-11 w-20" />
                </div>
                <Skeleton className="h-3 w-64" />
              </div>
            </CardContent>
          </Card>

          {/* Emergency Stop */}
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-40 mb-2" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-3 w-full" />
            </CardContent>
          </Card>
        </div>

        {/* Command History skeleton */}
        <Card>
          <CardHeader>
            <div className="flex justify-between">
              <div>
                <Skeleton className="h-5 w-36 mb-2" />
                <Skeleton className="h-4 w-48" />
              </div>
              <Skeleton className="h-11 w-11" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex items-start gap-3">
                    <Skeleton className="h-10 w-10 rounded" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-48" />
                    </div>
                  </div>
                  <Skeleton className="h-6 w-20" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
