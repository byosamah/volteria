"use client";

/**
 * Dashboard Layout
 *
 * Wraps all authenticated pages with sidebar and header.
 */

import { Sidebar } from "./sidebar";

interface DashboardLayoutProps {
  children: React.ReactNode;
  user?: {
    email?: string;
    full_name?: string;
  };
}

export function DashboardLayout({ children, user }: DashboardLayoutProps) {
  return (
    <div className="flex h-screen">
      <Sidebar user={user} />
      <main className="flex-1 overflow-auto bg-muted/30">
        {children}
      </main>
    </div>
  );
}
