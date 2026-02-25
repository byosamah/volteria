"use client";

/**
 * Project Notification Settings Component
 *
 * Renders the notification settings UI for a user-project assignment.
 * Supports Email and SMS (SMS marked as "Coming soon").
 */

import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { UserProjectNotificationSettings, AlarmSeverity } from "@/lib/types";

interface ProjectNotificationSettingsProps {
  settings: UserProjectNotificationSettings;
  onChange: (settings: UserProjectNotificationSettings) => void;
  disabled?: boolean;
}

// Severity options for the dropdown
const SEVERITY_OPTIONS: { value: AlarmSeverity; label: string }[] = [
  { value: "critical", label: "Critical only" },
  { value: "major", label: "Major and above" },
  { value: "minor", label: "Minor and above" },
  { value: "warning", label: "Warning and above" },
  { value: "info", label: "All severities" },
];

export function ProjectNotificationSettings({
  settings,
  onChange,
  disabled = false,
}: ProjectNotificationSettingsProps) {
  // Helper to update a single field
  const updateField = <K extends keyof UserProjectNotificationSettings>(
    field: K,
    value: UserProjectNotificationSettings[K]
  ) => {
    onChange({ ...settings, [field]: value });
  };

  return (
    <div className="space-y-4 pt-3 border-t">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
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
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        Alarm Notifications
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Email Settings */}
        <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Email</Label>
            <Checkbox
              checked={settings.email_enabled}
              onCheckedChange={(checked) =>
                updateField("email_enabled", checked === true)
              }
              disabled={disabled}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Severity</Label>
            <Select
              value={settings.email_min_severity}
              onValueChange={(value) =>
                updateField("email_min_severity", value as AlarmSeverity)
              }
              disabled={disabled || !settings.email_enabled}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="email_on_active"
                checked={settings.email_on_active}
                onCheckedChange={(checked) =>
                  updateField("email_on_active", checked === true)
                }
                disabled={disabled || !settings.email_enabled}
                className="h-3.5 w-3.5"
              />
              <Label
                htmlFor="email_on_active"
                className="text-xs text-muted-foreground cursor-pointer"
              >
                On Active
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="email_on_resolved"
                checked={settings.email_on_resolved}
                onCheckedChange={(checked) =>
                  updateField("email_on_resolved", checked === true)
                }
                disabled={disabled || !settings.email_enabled}
                className="h-3.5 w-3.5"
              />
              <Label
                htmlFor="email_on_resolved"
                className="text-xs text-muted-foreground cursor-pointer"
              >
                On Resolved
              </Label>
            </div>
          </div>
        </div>

        {/* SMS Settings */}
        <div className="space-y-3 p-3 bg-muted/30 rounded-lg opacity-60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium">SMS</Label>
              <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded text-muted-foreground">
                Coming soon
              </span>
            </div>
            <Checkbox
              checked={settings.sms_enabled}
              onCheckedChange={(checked) =>
                updateField("sms_enabled", checked === true)
              }
              disabled={true} // SMS disabled for now
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Severity</Label>
            <Select
              value={settings.sms_min_severity}
              onValueChange={(value) =>
                updateField("sms_min_severity", value as AlarmSeverity)
              }
              disabled={true} // SMS disabled for now
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="sms_on_active"
                checked={settings.sms_on_active}
                onCheckedChange={(checked) =>
                  updateField("sms_on_active", checked === true)
                }
                disabled={true} // SMS disabled for now
                className="h-3.5 w-3.5"
              />
              <Label
                htmlFor="sms_on_active"
                className="text-xs text-muted-foreground cursor-pointer"
              >
                On Active
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="sms_on_resolved"
                checked={settings.sms_on_resolved}
                onCheckedChange={(checked) =>
                  updateField("sms_on_resolved", checked === true)
                }
                disabled={true} // SMS disabled for now
                className="h-3.5 w-3.5"
              />
              <Label
                htmlFor="sms_on_resolved"
                className="text-xs text-muted-foreground cursor-pointer"
              >
                On Resolved
              </Label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Default notification settings for new assignments
export const DEFAULT_NOTIFICATION_SETTINGS: UserProjectNotificationSettings = {
  email_enabled: true,
  email_min_severity: "major",
  email_on_active: true,
  email_on_resolved: false,
  sms_enabled: false,
  sms_phone_number: null,
  sms_min_severity: "critical",
  sms_on_active: true,
  sms_on_resolved: false,
};
