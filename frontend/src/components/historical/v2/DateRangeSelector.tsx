"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { DATE_PRESETS, MAX_DATE_RANGE } from "./constants";
import type { DateRange } from "./types";

interface DateRangeSelectorProps {
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
}

export function DateRangeSelector({ dateRange, onDateRangeChange }: DateRangeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(new Date());
  const [selectingStart, setSelectingStart] = useState(true);

  // Format date + time for display
  const formatDateTime = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }) + " " + date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  // Format time for input
  const formatTimeInput = (date: Date) => {
    return date.toTimeString().slice(0, 5); // HH:MM
  };

  // Handle preset click
  const handlePreset = (hours: number) => {
    const end = new Date();
    const start = new Date();

    if (hours <= 24) {
      // For ≤24h presets (1h, 24h), use exact time range
      start.setTime(end.getTime() - hours * 60 * 60 * 1000);
    } else {
      // For day+ presets, use calendar days
      const days = Math.floor(hours / 24);
      start.setDate(start.getDate() - days);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    }

    onDateRangeChange({ start, end });
    setIsOpen(false);
  };

  // Get current preset if matching
  const getCurrentPreset = () => {
    const diffMs = dateRange.end.getTime() - dateRange.start.getTime();
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));

    // Check for 1h preset (approximately 1 hour difference)
    if (diffHours <= 1) {
      return "1h";
    }

    // Check for 24h preset (approximately 24 hours, exact time range)
    if (diffHours >= 23 && diffHours <= 25) {
      return "24h";
    }

    // For day+ presets (3d, 7d), check calendar days
    const startAtMidnight = dateRange.start.getHours() === 0 && dateRange.start.getMinutes() === 0;
    const endAtEndOfDay = dateRange.end.getHours() === 23 && dateRange.end.getMinutes() === 59;

    if (!startAtMidnight || !endAtEndOfDay) return null;

    const startDate = new Date(dateRange.start);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(dateRange.end);
    endDate.setHours(0, 0, 0, 0);

    const dayDiffMs = endDate.getTime() - startDate.getTime();
    const diffDays = Math.round(dayDiffMs / (1000 * 60 * 60 * 24));

    const preset = DATE_PRESETS.find((p) => p.days === diffDays && p.days > 1);
    return preset?.value || null;
  };

  // Navigate months
  const prevMonth = () => {
    const newMonth = new Date(viewMonth);
    newMonth.setMonth(newMonth.getMonth() - 1);
    setViewMonth(newMonth);
  };

  const nextMonth = () => {
    const newMonth = new Date(viewMonth);
    newMonth.setMonth(newMonth.getMonth() + 1);
    setViewMonth(newMonth);
  };

  // Get days in month
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay();

    const days: (Date | null)[] = [];

    for (let i = 0; i < startingDay; i++) {
      days.push(null);
    }

    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }

    return days;
  };

  // Check if date is in range
  const isInRange = (date: Date) => {
    const dateStart = new Date(date);
    dateStart.setHours(0, 0, 0, 0);
    const rangeStart = new Date(dateRange.start);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(dateRange.end);
    rangeEnd.setHours(0, 0, 0, 0);
    return dateStart >= rangeStart && dateStart <= rangeEnd;
  };

  const isStart = (date: Date) => {
    return date.toDateString() === dateRange.start.toDateString();
  };

  const isEnd = (date: Date) => {
    return date.toDateString() === dateRange.end.toDateString();
  };

  // Handle date click
  const handleDateClick = (date: Date) => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (date > today) return;

    // Use max daily range (server-side aggregation handles long ranges)
    const maxRangeDays = MAX_DATE_RANGE.daily;

    if (selectingStart) {
      const newStart = new Date(date);
      newStart.setHours(dateRange.start.getHours(), dateRange.start.getMinutes(), 0, 0);

      const maxEnd = new Date(newStart);
      maxEnd.setDate(maxEnd.getDate() + maxRangeDays);
      if (maxEnd > today) maxEnd.setTime(today.getTime());

      let newEnd = dateRange.end > maxEnd ? maxEnd : dateRange.end;
      if (newEnd < newStart) newEnd = new Date(newStart);

      onDateRangeChange({ start: newStart, end: newEnd });
      setSelectingStart(false);
    } else {
      const newEnd = new Date(date);
      newEnd.setHours(dateRange.end.getHours(), dateRange.end.getMinutes(), 59, 999);

      if (newEnd < dateRange.start) {
        onDateRangeChange({ start: newEnd, end: dateRange.start });
      } else {
        const diffDays = Math.round(
          (newEnd.getTime() - dateRange.start.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (diffDays > maxRangeDays) {
          const adjustedStart = new Date(newEnd);
          adjustedStart.setDate(adjustedStart.getDate() - maxRangeDays);
          onDateRangeChange({ start: adjustedStart, end: newEnd });
        } else {
          onDateRangeChange({ ...dateRange, end: newEnd });
        }
      }
      setSelectingStart(true);
    }
  };

  // Handle time change
  const handleTimeChange = (which: "start" | "end", timeStr: string) => {
    const [hours, minutes] = timeStr.split(":").map(Number);
    if (isNaN(hours) || isNaN(minutes)) return;

    if (which === "start") {
      const newStart = new Date(dateRange.start);
      newStart.setHours(hours, minutes, 0, 0);
      onDateRangeChange({ ...dateRange, start: newStart });
    } else {
      const newEnd = new Date(dateRange.end);
      newEnd.setHours(hours, minutes, 59, 999);
      onDateRangeChange({ ...dateRange, end: newEnd });
    }
  };

  const isDisabled = (date: Date) => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return date > today;
  };

  const currentPreset = getCurrentPreset();
  const days = getDaysInMonth(viewMonth);

  return (
    <div className="flex items-center gap-2">
      {/* Quick presets */}
      <div className="flex items-center rounded-lg border bg-card p-1">
        {DATE_PRESETS.map((preset) => (
          <Button
            key={preset.value}
            variant={currentPreset === preset.value ? "default" : "ghost"}
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => handlePreset(preset.hours)}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      {/* Custom date picker */}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="h-9 gap-2 bg-card hover:bg-muted/50 border-input"
          >
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">
              {formatDateTime(dateRange.start)}
            </span>
            <span className="text-muted-foreground">—</span>
            <span className="font-medium">
              {formatDateTime(dateRange.end)}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <div className="p-4 space-y-4">
            {/* Info banner */}
            <div className="text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-md flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" />
              Selecting {selectingStart ? "start" : "end"} date. Max: {MAX_DATE_RANGE.daily} days.
            </div>

            {/* Month navigation */}
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={prevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="font-semibold">
                {viewMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </span>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={nextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 gap-1 text-center">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
                <div key={day} className="text-xs font-medium text-muted-foreground py-1">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {days.map((day, i) => (
                <button
                  key={i}
                  disabled={!day || isDisabled(day)}
                  onClick={() => day && handleDateClick(day)}
                  className={`
                    h-8 w-8 text-sm rounded-md transition-all
                    ${!day ? "invisible" : ""}
                    ${day && isDisabled(day) ? "text-muted-foreground/40 cursor-not-allowed" : ""}
                    ${day && !isDisabled(day) && !isInRange(day) ? "hover:bg-muted cursor-pointer" : ""}
                    ${day && isInRange(day) && !isStart(day) && !isEnd(day) ? "bg-primary/10 text-primary" : ""}
                    ${day && isStart(day) ? "bg-primary text-primary-foreground font-medium" : ""}
                    ${day && isEnd(day) ? "bg-primary text-primary-foreground font-medium" : ""}
                  `}
                >
                  {day?.getDate()}
                </button>
              ))}
            </div>

            {/* Time inputs */}
            <div className="grid grid-cols-2 gap-3 pt-3 border-t">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Start Time</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={formatTimeInput(dateRange.start)}
                    onChange={(e) => handleTimeChange("start", e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">End Time</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={formatTimeInput(dateRange.end)}
                    onChange={(e) => handleTimeChange("end", e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Selected range display */}
            <div className="flex items-center justify-between text-sm pt-2 border-t bg-muted/30 -mx-4 -mb-4 px-4 py-3 rounded-b-lg">
              <span className="text-muted-foreground">Selected:</span>
              <span className="font-medium">
                {formatDateTime(dateRange.start)} — {formatDateTime(dateRange.end)}
              </span>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
