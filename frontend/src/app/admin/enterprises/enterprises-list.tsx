"use client";

/**
 * Enterprises List Component
 *
 * Client component for displaying and managing enterprises.
 * Includes create dialog and search functionality.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface Enterprise {
  id: string;
  name: string;
  enterprise_id: string;
  contact_email: string | null;
  city: string | null;
  country: string | null;
  is_active: boolean;
  created_at: string;
}

interface EnterprisesListProps {
  enterprises: Enterprise[];
}

export function EnterprisesList({ enterprises: initialEnterprises }: EnterprisesListProps) {
  const router = useRouter();
  const supabase = createClient();

  const [enterprises, setEnterprises] = useState(initialEnterprises);
  const [searchQuery, setSearchQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Create form state
  const [formData, setFormData] = useState({
    name: "",
    enterprise_id: "",
    contact_email: "",
    city: "",
    country: "",
  });

  // Filter enterprises by search
  const filteredEnterprises = enterprises.filter((e) => {
    const search = searchQuery.toLowerCase();
    return (
      e.name.toLowerCase().includes(search) ||
      e.enterprise_id.toLowerCase().includes(search) ||
      (e.city && e.city.toLowerCase().includes(search)) ||
      (e.country && e.country.toLowerCase().includes(search))
    );
  });

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    // Auto-generate enterprise_id from name
    if (name === "name") {
      const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      setFormData((prev) => ({ ...prev, enterprise_id: slug }));
    }
  };

  // Handle create enterprise
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate
      if (!formData.name.trim()) {
        toast.error("Enterprise name is required");
        setLoading(false);
        return;
      }

      if (!formData.enterprise_id.trim()) {
        toast.error("Enterprise ID is required");
        setLoading(false);
        return;
      }

      // Create enterprise
      const { data, error } = await supabase
        .from("enterprises")
        .insert({
          name: formData.name.trim(),
          enterprise_id: formData.enterprise_id.trim(),
          contact_email: formData.contact_email.trim() || null,
          city: formData.city.trim() || null,
          country: formData.country.trim() || null,
          is_active: true,
        })
        .select()
        .single();

      if (error) {
        console.error("Error creating enterprise:", error);
        if (error.code === "23505") {
          toast.error("Enterprise ID already exists");
        } else {
          toast.error(error.message || "Failed to create enterprise");
        }
        setLoading(false);
        return;
      }

      toast.success("Enterprise created successfully");
      setEnterprises([...enterprises, data]);
      setCreateOpen(false);
      setFormData({
        name: "",
        enterprise_id: "",
        contact_email: "",
        city: "",
        country: "",
      });
      router.refresh();
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Search and Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <Input
            placeholder="Search enterprises..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 min-h-[44px]"
          />
        </div>

        <Button onClick={() => setCreateOpen(true)} className="min-h-[44px]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 mr-2"
          >
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          Add Enterprise
        </Button>
      </div>

      {/* Enterprises Grid */}
      {filteredEnterprises.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6 text-muted-foreground"
              >
                <path d="M3 21h18" />
                <path d="M9 8h1" />
                <path d="M9 12h1" />
                <path d="M9 16h1" />
                <path d="M14 8h1" />
                <path d="M14 12h1" />
                <path d="M14 16h1" />
                <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {searchQuery ? "No enterprises found" : "No enterprises yet"}
            </h3>
            <p className="text-muted-foreground text-center max-w-sm">
              {searchQuery
                ? "Try adjusting your search terms."
                : "Create your first enterprise to get started."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredEnterprises.map((enterprise) => (
            <Card key={enterprise.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{enterprise.name}</CardTitle>
                    <CardDescription className="font-mono text-xs">
                      {enterprise.enterprise_id}
                    </CardDescription>
                  </div>
                  <Badge variant={enterprise.is_active ? "default" : "secondary"}>
                    {enterprise.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-sm space-y-2">
                  {enterprise.contact_email && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4"
                      >
                        <rect width="20" height="16" x="2" y="4" rx="2" />
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                      </svg>
                      <span className="truncate">{enterprise.contact_email}</span>
                    </div>
                  )}
                  {(enterprise.city || enterprise.country) && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4"
                      >
                        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      <span>
                        {[enterprise.city, enterprise.country].filter(Boolean).join(", ")}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4"
                    >
                      <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
                      <line x1="16" x2="16" y1="2" y2="6" />
                      <line x1="8" x2="8" y1="2" y2="6" />
                      <line x1="3" x2="21" y1="10" y2="10" />
                    </svg>
                    <span>Created {new Date(enterprise.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Enterprise Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Enterprise</DialogTitle>
            <DialogDescription>
              Add a new organization to the platform.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">
                Enterprise Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g., Acme Corporation"
                value={formData.name}
                onChange={handleChange}
                className="min-h-[44px]"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="enterprise_id">
                Enterprise ID <span className="text-red-500">*</span>
              </Label>
              <Input
                id="enterprise_id"
                name="enterprise_id"
                placeholder="e.g., acme-corporation"
                value={formData.enterprise_id}
                onChange={handleChange}
                className="min-h-[44px] font-mono"
                required
              />
              <p className="text-xs text-muted-foreground">
                Unique identifier (auto-generated from name)
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  name="city"
                  placeholder="e.g., Dubai"
                  value={formData.city}
                  onChange={handleChange}
                  className="min-h-[44px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="country">Country</Label>
                <Input
                  id="country"
                  name="country"
                  placeholder="e.g., UAE"
                  value={formData.country}
                  onChange={handleChange}
                  className="min-h-[44px]"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact_email">Contact Email</Label>
              <Input
                id="contact_email"
                name="contact_email"
                type="email"
                placeholder="e.g., admin@acme.com"
                value={formData.contact_email}
                onChange={handleChange}
                className="min-h-[44px]"
              />
            </div>

            <DialogFooter className="flex-col gap-2 sm:flex-row pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                className="min-h-[44px] w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading} className="min-h-[44px] w-full sm:w-auto">
                {loading ? "Creating..." : "Create Enterprise"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
