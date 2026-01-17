"use client";

/**
 * Register Section Component
 *
 * Displays a section of registers (Logging/Visualization/Alarms)
 * with collapsible groups inside.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RegisterGroup } from "./register-group";
import type { RegisterSectionProps } from "./types";

// Section icons and descriptions
const SECTION_CONFIG = {
  logging: {
    description: "Registers stored in database for historical data and control logic",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" x2="12" y1="3" y2="15" />
      </svg>
    ),
  },
  visualization: {
    description: "Registers for live display only (not stored in database)",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  alarms: {
    description: "Event-based alarms with threshold conditions",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
    ),
  },
};

export function RegisterSection({
  title,
  section,
  groups,
  registerValues,
  loadingGroups,
  pendingWrites,
  writeStatus,
  onRequestData,
  onWriteValue,
  onPendingWriteChange,
}: RegisterSectionProps) {
  const config = SECTION_CONFIG[section];

  // Count total registers
  const totalRegisters = groups.reduce((sum, g) => sum + g.registers.length, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="text-muted-foreground">{config.icon}</div>
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription>
              {config.description} ({totalRegisters} registers)
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {groups.map((group) => {
          const groupKey = `${section}-${group.name}`;
          const isLoading = loadingGroups.has(groupKey);

          return (
            <RegisterGroup
              key={groupKey}
              group={group}
              section={section}
              isLoading={isLoading}
              registerValues={registerValues}
              pendingWrites={pendingWrites}
              writeStatus={writeStatus}
              onRequestData={() =>
                onRequestData(section, group.name, group.registers)
              }
              onWriteValue={(register, value) =>
                onWriteValue(section, register, value)
              }
              onPendingWriteChange={onPendingWriteChange}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}
