/**
 * New Site Page
 *
 * Form to create a new site within a project.
 * Sites are physical locations with one controller each.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { use } from "react";

export default function NewSitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [dgReserveKw, setDgReserveKw] = useState("50");
  const [controlIntervalMs, setControlIntervalMs] = useState("1000");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("You must be logged in to create a site");
        setLoading(false);
        return;
      }

      // Create the site
      const { data, error: insertError } = await supabase
        .from("sites")
        .insert({
          project_id: projectId,
          name: name.trim(),
          location: location.trim() || null,
          description: description.trim() || null,
          dg_reserve_kw: parseFloat(dgReserveKw) || 50,
          control_interval_ms: parseInt(controlIntervalMs) || 1000,
          controller_status: "offline",
          is_active: true,
          created_by: user.id,
        })
        .select()
        .single();

      if (insertError) {
        throw insertError;
      }

      // Redirect to the new site
      router.push(`/projects/${projectId}/sites/${data.id}`);
    } catch (err) {
      console.error("Failed to create site:", err);
      setError(err instanceof Error ? err.message : "Failed to create site");
      setLoading(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4 md:space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Link
              href={`/projects/${projectId}`}
              className="text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </Link>
            <h1 className="text-2xl md:text-3xl font-bold">Add New Site</h1>
          </div>
          <p className="text-muted-foreground text-sm md:text-base">
            Create a new physical location with a controller
          </p>
        </div>

        {/* Form Card */}
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Site Details</CardTitle>
            <CardDescription>
              Enter the basic information for your new site
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Site Name */}
              <div className="space-y-2">
                <Label htmlFor="name">Site Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Main Factory, Warehouse A"
                  required
                />
              </div>

              {/* Location */}
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g., Riyadh Industrial Area"
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description of the site"
                  rows={3}
                />
              </div>

              {/* Control Settings */}
              <div className="border-t pt-6 space-y-4">
                <h3 className="font-medium">Control Settings</h3>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="dgReserve">DG Reserve (kW)</Label>
                    <Input
                      id="dgReserve"
                      type="number"
                      min="0"
                      step="1"
                      value={dgReserveKw}
                      onChange={(e) => setDgReserveKw(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Minimum power the DG should maintain
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="controlInterval">Control Interval (ms)</Label>
                    <Input
                      id="controlInterval"
                      type="number"
                      min="100"
                      max="10000"
                      step="100"
                      value={controlIntervalMs}
                      onChange={(e) => setControlIntervalMs(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      How often the controller reads and adjusts
                    </p>
                  </div>
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm">
                  {error}
                </div>
              )}

              {/* Submit Buttons */}
              <div className="flex gap-3 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push(`/projects/${projectId}`)}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={loading || !name.trim()}>
                  {loading ? "Creating..." : "Create Site"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
