/**
 * Loading Skeleton for Data Usage Page
 *
 * Shows skeleton placeholders while data is being fetched
 */

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DataUsageLoading() {
  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      {/* Header Skeleton */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-6 w-16" />
          </div>
          <Skeleton className="h-4 w-80 mt-2" />
        </div>
      </div>

      {/* Summary Stats Cards Skeleton */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-20 mt-1" />
            </CardHeader>
          </Card>
        ))}
      </div>

      {/* Enterprise Usage List Skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-36 mt-1" />
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters Skeleton */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Skeleton className="h-10 w-64" />
            <div className="flex gap-2 items-center">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-10 w-40" />
            </div>
          </div>

          {/* Table Skeleton */}
          <div className="rounded-md border">
            {/* Table Header */}
            <div className="border-b bg-muted/50 p-3">
              <div className="flex items-center gap-4">
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24 hidden md:block" />
                <Skeleton className="h-4 w-32 hidden md:block" />
                <Skeleton className="h-4 w-24 hidden lg:block" />
                <Skeleton className="h-4 w-20 ml-auto" />
              </div>
            </div>

            {/* Table Rows */}
            {[...Array(5)].map((_, i) => (
              <div key={i} className="border-b p-4">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-6 w-6" />
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4" />
                    <Skeleton className="h-4 w-40" />
                  </div>
                  <Skeleton className="h-6 w-20 hidden md:block" />
                  <div className="hidden md:flex items-center gap-2 flex-1 max-w-[200px]">
                    <Skeleton className="h-2 flex-1" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                  <Skeleton className="h-4 w-24 hidden lg:block" />
                  <Skeleton className="h-6 w-16 ml-auto" />
                </div>
              </div>
            ))}
          </div>

          {/* Results Summary Skeleton */}
          <Skeleton className="h-4 w-48" />
        </CardContent>
      </Card>
    </div>
  );
}
