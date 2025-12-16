/**
 * Loading skeleton for Controller Templates page
 *
 * Shows placeholder UI while data is being fetched.
 */

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function Loading() {
  return (
    <DashboardLayout user={{}}>
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl md:text-3xl font-bold">Controller Templates</h1>
              <Badge variant="secondary">Super Admin</Badge>
            </div>
            <p className="text-muted-foreground text-sm md:text-base">
              Manage templates for controllers and gateways with alarm definitions
            </p>
          </div>
        </div>

        {/* Stats Grid Skeleton */}
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <div className="h-4 w-24 bg-muted rounded animate-pulse" />
                <div className="h-8 w-12 bg-muted rounded animate-pulse mt-2" />
              </CardHeader>
            </Card>
          ))}
        </div>

        {/* List Skeleton */}
        <div className="space-y-4">
          {/* Add Button Skeleton */}
          <div className="flex justify-end">
            <div className="h-11 w-40 bg-muted rounded animate-pulse" />
          </div>

          {/* Template Cards Skeleton */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <div className="h-5 w-32 bg-muted rounded animate-pulse" />
                      <div className="h-3 w-24 bg-muted rounded animate-pulse" />
                    </div>
                    <div className="h-5 w-16 bg-muted rounded animate-pulse" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="h-3 w-full bg-muted rounded animate-pulse" />
                    <div className="h-3 w-3/4 bg-muted rounded animate-pulse" />
                  </div>
                  <div className="flex gap-2">
                    <div className="h-5 w-12 bg-muted rounded animate-pulse" />
                    <div className="h-5 w-12 bg-muted rounded animate-pulse" />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <div className="h-8 flex-1 bg-muted rounded animate-pulse" />
                    <div className="h-8 w-24 bg-muted rounded animate-pulse" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
