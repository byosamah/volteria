"use client";

/**
 * ProjectCard Component (Client Component)
 *
 * Displays a single project card with edit button.
 * Must be a Client Component because it uses onClick handlers.
 */

import { memo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Project type definition
export interface Project {
  id: string;
  name: string;
  location: string | null;
  description: string | null;
  deviceCount: number;       // Non-master devices (inverters, meters, etc.)
  siteCount: number;
  controllerCount: number;   // Master devices (controllers/gateways)
  enterprises: { id: string; name: string } | null;  // Enterprise the project belongs to
}

interface ProjectCardProps {
  project: Project;
  isInactive?: boolean;
}

export const ProjectCard = memo(function ProjectCard({ project, isInactive }: ProjectCardProps) {
  const router = useRouter();

  const handleCardClick = () => {
    router.push(`/projects/${project.id}`);
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/projects/${project.id}/settings`);
  };

  return (
    <Card
      className={`h-full hover:border-primary/50 transition-colors cursor-pointer ${isInactive ? "opacity-60 border-dashed" : ""}`}
      onClick={handleCardClick}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCardClick();
        }
      }}
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">{project.name}</CardTitle>
              {isInactive && (
                <Badge variant="secondary" className="text-xs">Inactive</Badge>
              )}
            </div>
            <CardDescription>
              {project.location || "No location set"}
            </CardDescription>
            {/* Enterprise badge */}
            {project.enterprises && (
              <Badge variant="outline" className="mt-1 text-xs">
                {project.enterprises.name}
              </Badge>
            )}
          </div>
          {/* Edit button - navigates to project settings */}
          <button
            type="button"
            onClick={handleEditClick}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
            title="Edit project"
            aria-label={`Edit project ${project.name}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="h-4 w-4 text-muted-foreground"
              aria-hidden="true">
              <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
              <path d="m15 5 4 4"/>
            </svg>
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {project.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {project.description}
            </p>
          )}

          <div className="grid grid-cols-3 gap-4 pt-2">
            <div>
              <p className="text-xs text-muted-foreground">Sites</p>
              <p className="text-lg font-semibold">{project.siteCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Controllers</p>
              <p className="text-lg font-semibold">{project.controllerCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Devices</p>
              <p className="text-lg font-semibold">{project.deviceCount}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
