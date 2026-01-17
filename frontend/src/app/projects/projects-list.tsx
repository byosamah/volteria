"use client";

/**
 * Projects List Client Component
 *
 * Handles filtering between active and all projects.
 */

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Filter } from "lucide-react";
import Link from "next/link";
import { ProjectCard } from "@/components/projects/project-card";

interface Project {
  id: string;
  name: string;
  location: string | null;
  description: string | null;
  deviceCount: number;
  siteCount: number;
  controllerCount: number;
  is_active: boolean;
  enterprises: { id: string; name: string } | null;
}

interface ProjectsListProps {
  projects: Project[];
}

export function ProjectsList({ projects }: ProjectsListProps) {
  const [showInactive, setShowInactive] = useState(false);

  // Filter projects based on active status
  const filteredProjects = showInactive
    ? projects
    : projects.filter((p) => p.is_active !== false);

  // Count inactive projects
  const inactiveCount = projects.filter((p) => p.is_active === false).length;

  return (
    <div className="space-y-4">
      {/* Filter toggle - only show if there are inactive projects */}
      {inactiveCount > 0 && (
        <div className="flex justify-end">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={`gap-2 ${showInactive ? "border-amber-500 text-amber-600" : ""}`}
              >
                <Filter className="h-4 w-4" />
                {showInactive ? "All" : "Active"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56" align="end">
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Project Filter</h4>
                <p className="text-xs text-muted-foreground">
                  Choose which projects to show
                </p>
                <div className="space-y-2">
                  <Button
                    variant={!showInactive ? "default" : "outline"}
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => setShowInactive(false)}
                  >
                    Active only
                    <span className="ml-auto text-xs opacity-70">Default</span>
                  </Button>
                  <Button
                    variant={showInactive ? "default" : "outline"}
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => setShowInactive(true)}
                  >
                    All ({inactiveCount} inactive)
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Projects Grid */}
      {filteredProjects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-muted-foreground">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">
              {showInactive ? "No projects yet" : "No active projects"}
            </h3>
            <p className="text-muted-foreground text-center max-w-sm mb-4">
              {showInactive
                ? "Create your first project to start monitoring your hybrid energy system."
                : "All projects are inactive. Toggle the filter to see inactive projects."}
            </p>
            {showInactive && (
              <Button asChild>
                <Link href="/projects/new">Create Project</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isInactive={project.is_active === false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
