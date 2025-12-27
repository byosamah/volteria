"use client";

/**
 * Group Combobox Component
 *
 * A searchable dropdown that allows selecting existing groups
 * or creating new ones inline. Used to organize Modbus registers
 * into collapsible groups within device templates.
 */

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Plus, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

interface GroupComboboxProps {
  /** Currently selected group name */
  value: string;
  /** Callback when group is selected or created */
  onChange: (value: string) => void;
  /** List of existing groups from the template */
  groups: string[];
  /** Placeholder text when no group selected */
  placeholder?: string;
}

export function GroupCombobox({
  value,
  onChange,
  groups,
  placeholder = "Select or create group...",
}: GroupComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter groups by search term
  const filteredGroups = groups.filter((g) =>
    g.toLowerCase().includes(search.toLowerCase())
  );

  // Check if search matches an existing group exactly (case-insensitive)
  const exactMatch = groups.some(
    (g) => g.toLowerCase() === search.toLowerCase()
  );

  // Show "Create new" option if search has text and doesn't exactly match existing group
  const showCreateOption = search.trim() && !exactMatch;

  // Focus input when popover opens
  useEffect(() => {
    if (open && inputRef.current) {
      // Small delay to ensure popover is rendered
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Reset search when popover closes
  useEffect(() => {
    if (!open) {
      setSearch("");
    }
  }, [open]);

  const handleSelect = (groupName: string) => {
    onChange(groupName);
    setOpen(false);
    setSearch("");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="min-h-[44px] w-full justify-between font-normal"
        >
          <span className={value ? "" : "text-muted-foreground"}>
            {value || placeholder}
          </span>
          <div className="flex items-center gap-1 ml-2">
            {value && (
              <X
                className="h-4 w-4 shrink-0 opacity-50 hover:opacity-100"
                onClick={handleClear}
              />
            )}
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        {/* Search input */}
        <div className="p-2 border-b">
          <Input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search or type new group..."
            className="h-9"
          />
        </div>

        {/* Options list */}
        <div className="max-h-[200px] overflow-y-auto p-1">
          {/* Create new option (shown when typing non-matching text) */}
          {showCreateOption && (
            <button
              type="button"
              onClick={() => handleSelect(search.trim())}
              className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground text-left"
            >
              <Plus className="h-4 w-4 text-primary" />
              <span>
                Create &quot;<span className="font-medium">{search.trim()}</span>&quot;
              </span>
            </button>
          )}

          {/* Existing groups */}
          {filteredGroups.length > 0 ? (
            <div className="py-1">
              {showCreateOption && <div className="h-px bg-border my-1" />}
              {filteredGroups.map((group) => (
                <button
                  key={group}
                  type="button"
                  onClick={() => handleSelect(group)}
                  className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded-sm hover:bg-accent hover:text-accent-foreground text-left"
                >
                  <Check
                    className={`h-4 w-4 ${
                      value === group ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  {group}
                </button>
              ))}
            </div>
          ) : (
            !showCreateOption && (
              <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                {search
                  ? "No groups found. Type to create a new one."
                  : "No groups yet. Type to create one."}
              </div>
            )
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
