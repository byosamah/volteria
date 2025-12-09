"use client";

/**
 * FormattedDate Component
 *
 * Client-side date formatting to avoid hydration mismatches.
 * Server and client may have different timezones/locales, so
 * formatting dates on the client ensures consistency.
 */

import { useEffect, useState } from "react";

interface FormattedDateProps {
  date: string | Date;
  className?: string;
}

export function FormattedDate({ date, className }: FormattedDateProps) {
  // Start with a placeholder to avoid hydration mismatch
  const [formattedDate, setFormattedDate] = useState<string>("");

  useEffect(() => {
    // Format date on client side only
    const dateObj = typeof date === "string" ? new Date(date) : date;
    setFormattedDate(dateObj.toLocaleString());
  }, [date]);

  // Show nothing during SSR, then show formatted date on client
  if (!formattedDate) {
    return <span className={className}>--</span>;
  }

  return <span className={className}>{formattedDate}</span>;
}
