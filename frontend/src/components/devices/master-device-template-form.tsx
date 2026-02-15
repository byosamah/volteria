"use client";

/**
 * Master Device Template Form Component
 *
 * Dialog form for creating/editing controller templates (Master Devices).
 * Features:
 * - Basic info: template_id, name, description, controller_type, brand, model
 * - Template type: public (super_admin/backend_admin) or custom (auto for others)
 * - Calculated Fields table with storage_mode (Log/Viz Only) - fetched from DB
 * - Controller Readings table with storage_mode, logging frequency, and alarm thresholds
 */

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import type { ControllerTemplate, SystemRegister, CalculatedFieldDefinition } from "@/lib/types";
import { CONTROLLER_READINGS, SITE_LEVEL_ALARMS, type SiteLevelAlarm } from "./master-device-templates-list";
import { Badge } from "@/components/ui/badge";
import {
  ControllerReadingsForm,
  type ReadingSelection,
  type StatusAlarmConfig,
  type StorageMode,
  getDefaultAlarmConfig,
} from "./controller-readings-form";

// =============================================================================
// TYPES
// =============================================================================

interface MasterDeviceTemplateFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: ControllerTemplate | null;
  userRole?: string;
  userEnterpriseId?: string | null;
  onSuccess: (template: ControllerTemplate) => void;
  /** When true, creates a new template from the passed template data (copy) */
  isDuplicating?: boolean;
}

// Hardware option from approved_hardware table
interface HardwareOption {
  id: string;
  name: string;
  brand: string;
  model: string;
  hardware_type: string;
  is_active: boolean;
}

// Enterprise option for custom templates
interface EnterpriseOption {
  id: string;
  name: string;
}

// =============================================================================
// HELPER: Generate unique numeric template ID
// Uses timestamp + random digits for uniqueness
// =============================================================================
function generateNumericTemplateId(): string {
  const timestamp = Date.now().toString().slice(-8); // Last 8 digits of timestamp
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `${timestamp}${random}`;
}

// Types imported from controller-readings-form.tsx:
// - StorageMode, ReadingSelection, StatusAlarmConfig, getDefaultAlarmConfig

// Field selection with storage mode and logging frequency (for calculated fields)
interface FieldSelection {
  field_id: string;
  name: string;
  storage_mode: StorageMode;
  logging_frequency_seconds: number;
  enabled: boolean;
}

// Form data interface
// Note: template_id is auto-generated for new templates
// Note: brand and model are read-only (auto-populated from hardware)
interface FormData {
  name: string;
  description: string;
  hardware_id: string; // ID from approved_hardware table
  template_type: "public" | "custom";
  enterprise_id: string; // For custom templates
  is_active: boolean; // Only super_admin can toggle this
}

// Logging frequency options for calculated fields (matches register-form.tsx)
const CALC_FIELD_FREQUENCY_OPTIONS = [
  { value: 1, label: "1 second" },
  { value: 5, label: "5 seconds" },
  { value: 10, label: "10 seconds" },
  { value: 30, label: "30 seconds" },
  { value: 60, label: "1 minute" },
  { value: 300, label: "5 minutes" },
  { value: 600, label: "10 minutes" },
  { value: 900, label: "15 minutes" },
  { value: 1800, label: "30 minutes" },
  { value: 3600, label: "1 hour" },
  { value: 86400, label: "24 hours" },
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Check if user can create PUBLIC templates
function canCreatePublicTemplate(role?: string): boolean {
  if (!role) return false;
  return ["super_admin", "backend_admin"].includes(role);
}

// Check if user can change enterprise selection
// Only super_admin and backend_admin can change it; others see it auto-selected
function canChangeEnterprise(role?: string): boolean {
  if (!role) return false;
  return ["super_admin", "backend_admin"].includes(role);
}

// Check if user can toggle template active status
// Only super_admin can activate/deactivate templates
function canToggleActiveStatus(role?: string): boolean {
  if (!role) return false;
  return role === "super_admin";
}

// Check if user can edit controller readings (fields, frequencies, alarms)
// Only super_admin and backend_admin can modify these critical settings
function canEditControllerReadings(role?: string): boolean {
  if (!role) return false;
  return ["super_admin", "backend_admin"].includes(role);
}

// =============================================================================
// COMPONENT
// =============================================================================

export function MasterDeviceTemplateForm({
  open,
  onOpenChange,
  template,
  userRole,
  userEnterpriseId,
  onSuccess,
  isDuplicating = false,
}: MasterDeviceTemplateFormProps) {
  // Edit mode: template exists AND not duplicating
  // Duplicate mode: template exists AND isDuplicating (creates new record)
  const isEditing = !!template && !isDuplicating;

  // Form state
  // Note: template_id is auto-generated, brand/model are read-only from hardware
  const [formData, setFormData] = useState<FormData>({
    name: "",
    description: "",
    hardware_id: "",
    template_type: canCreatePublicTemplate(userRole) ? "public" : "custom",
    enterprise_id: userEnterpriseId || "",
    is_active: true, // New templates are active by default
  });

  // Hardware options from approved_hardware table
  const [hardwareOptions, setHardwareOptions] = useState<HardwareOption[]>([]);
  const [isLoadingHardware, setIsLoadingHardware] = useState(false);

  // Enterprise options for custom templates
  const [enterpriseOptions, setEnterpriseOptions] = useState<EnterpriseOption[]>([]);
  const [isLoadingEnterprises, setIsLoadingEnterprises] = useState(false);

  // Get selected hardware details (for displaying brand/model)
  const selectedHardware = hardwareOptions.find((h) => h.id === formData.hardware_id);

  // Database calculated fields (fetched from calculated_field_definitions)
  const [dbCalculatedFields, setDbCalculatedFields] = useState<CalculatedFieldDefinition[]>([]);
  const [isLoadingCalculatedFields, setIsLoadingCalculatedFields] = useState(false);

  // Calculated fields selection (populated from DB)
  const [calculatedFields, setCalculatedFields] = useState<FieldSelection[]>([]);

  // Controller readings selection with alarm config and logging frequency
  // Default: all enabled with default frequencies (critical for controller health monitoring)
  const [controllerReadings, setControllerReadings] = useState<ReadingSelection[]>(
    CONTROLLER_READINGS.map((field) => ({
      field_id: field.field_id,
      name: field.name,
      unit: field.unit,
      storage_mode: "log" as StorageMode,
      logging_frequency_seconds: field.default_frequency || 600,
      enabled: true, // All enabled by default
      alarm_config: getDefaultAlarmConfig(field.field_id),
    }))
  );

  // Online/Offline status alarm configuration
  const [statusAlarm, setStatusAlarm] = useState<StatusAlarmConfig>({
    enabled: true,
    offline_severity: "critical",
  });

  // Site-level alarms (power outage detection, etc.)
  const [siteLevelAlarms, setSiteLevelAlarms] = useState<SiteLevelAlarm[]>(
    SITE_LEVEL_ALARMS.map((alarm) => ({ ...alarm }))
  );

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch hardware options when dialog opens
  useEffect(() => {
    if (!open) return;

    const fetchHardwareOptions = async () => {
      setIsLoadingHardware(true);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("approved_hardware")
          .select("id, name, brand, model, hardware_type, is_active")
          .order("name");

        if (error) throw error;
        setHardwareOptions(data || []);
      } catch (error) {
        console.error("Error fetching hardware options:", error);
        toast.error("Failed to load hardware options");
      } finally {
        setIsLoadingHardware(false);
      }
    };

    fetchHardwareOptions();
  }, [open]);

  // Fetch enterprise options when dialog opens (for custom templates)
  useEffect(() => {
    if (!open) return;

    const fetchEnterpriseOptions = async () => {
      setIsLoadingEnterprises(true);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("enterprises")
          .select("id, name")
          .order("name");

        if (error) throw error;
        setEnterpriseOptions(data || []);
      } catch (error) {
        console.error("Error fetching enterprise options:", error);
        toast.error("Failed to load enterprise options");
      } finally {
        setIsLoadingEnterprises(false);
      }
    };

    fetchEnterpriseOptions();
  }, [open]);

  // Fetch calculated fields from database when dialog opens
  useEffect(() => {
    if (!open) return;

    const fetchCalculatedFields = async () => {
      setIsLoadingCalculatedFields(true);
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("calculated_field_definitions")
          .select("*")
          .eq("scope", "controller")
          .eq("is_active", true)
          .order("name");

        if (error) throw error;
        setDbCalculatedFields((data as CalculatedFieldDefinition[]) || []);
      } catch (error) {
        console.error("Error fetching calculated fields:", error);
        toast.error("Failed to load calculated fields");
      } finally {
        setIsLoadingCalculatedFields(false);
      }
    };

    fetchCalculatedFields();
  }, [open]);

  // Update calculated fields selection when dbCalculatedFields loads
  useEffect(() => {
    if (dbCalculatedFields.length === 0) return;

    // Only update if we don't have a template to load from
    if (!template || !open) {
      setCalculatedFields(
        dbCalculatedFields.map((field) => ({
          field_id: field.field_id,
          name: field.name,
          storage_mode: "log" as StorageMode,
          logging_frequency_seconds: field.logging_frequency_seconds || 60,
          enabled: false,
        }))
      );
    }
  }, [dbCalculatedFields, template, open]);

  // Reset form when dialog opens or template changes
  useEffect(() => {
    if (open) {
      if (template) {
        // Edit or Duplicate mode - populate with existing data
        // When duplicating: add " (Copy)" to name, force custom type for non-admins
        const isDupe = isDuplicating;

        // Determine template type and enterprise for duplicate
        let newTemplateType = template.template_type;
        let newEnterpriseId = template.enterprise_id || "";

        if (isDupe) {
          // Non-admin users always create custom templates assigned to their enterprise
          if (!canCreatePublicTemplate(userRole)) {
            newTemplateType = "custom";
            newEnterpriseId = userEnterpriseId || "";
          }
        }

        setFormData({
          name: isDupe ? `${template.name} (Copy)` : template.name,
          description: template.description || "",
          hardware_id: template.hardware_type_id || "",
          template_type: newTemplateType,
          enterprise_id: newEnterpriseId,
          is_active: isDupe ? true : template.is_active ?? true, // Duplicates are always active
        });

        // Parse calculated fields from template using DB fields
        const templateCalcFields = template.calculated_fields || [];
        if (dbCalculatedFields.length > 0) {
          setCalculatedFields(
            dbCalculatedFields.map((field) => {
              // Find if this field exists in template's calculated_fields
              const existing = Array.isArray(templateCalcFields)
                ? templateCalcFields.find((f: unknown) => {
                    if (typeof f === "string") return f === field.field_id;
                    if (typeof f === "object" && f !== null) {
                      return (f as { field_id?: string }).field_id === field.field_id;
                    }
                    return false;
                  })
                : null;

              if (existing && typeof existing === "object") {
                return {
                  field_id: field.field_id,
                  name: field.name,
                  storage_mode: (existing as { storage_mode?: StorageMode }).storage_mode || "log",
                  logging_frequency_seconds: (existing as { logging_frequency_seconds?: number }).logging_frequency_seconds || field.logging_frequency_seconds || 60,
                  enabled: true,
                };
              } else if (typeof existing === "string") {
                return {
                  field_id: field.field_id,
                  name: field.name,
                  storage_mode: "log" as StorageMode,
                  logging_frequency_seconds: field.logging_frequency_seconds || 60,
                  enabled: true,
                };
              }
              return {
                field_id: field.field_id,
                name: field.name,
                storage_mode: "log" as StorageMode,
                logging_frequency_seconds: field.logging_frequency_seconds || 60,
                enabled: false,
              };
            })
          );
        }

        // Parse controller readings from template registers with alarm config
        const templateRegisters = template.registers || [];
        const templateAlarms = template.alarm_definitions || [];

        setControllerReadings(
          CONTROLLER_READINGS.map((field) => {
            const existing = templateRegisters.find((r) => r.field === field.field_id);
            // Find alarm definition for this field
            const alarmDef = templateAlarms.find(
              (a) => a.source_key === field.field_id && a.source_type === "device_info"
            );

            // Parse alarm config from alarm definition
            let alarmConfig = getDefaultAlarmConfig(field.field_id);
            if (alarmDef) {
              const warningCondition = alarmDef.conditions?.find((c) => c.severity === "warning");
              const criticalCondition = alarmDef.conditions?.find((c) => c.severity === "critical");
              alarmConfig = {
                enabled: alarmDef.enabled_by_default ?? true,
                warning_threshold: warningCondition?.value ?? null,
                critical_threshold: criticalCondition?.value ?? null,
                warning_operator: (warningCondition?.operator as ">" | "<") || ">",
                critical_operator: (criticalCondition?.operator as ">" | "<") || ">",
              };
            }

            if (existing) {
              return {
                field_id: field.field_id,
                name: field.name,
                unit: field.unit,
                storage_mode: "log" as StorageMode,
                logging_frequency_seconds: (existing as { logging_frequency_seconds?: number }).logging_frequency_seconds || 60,
                enabled: true,
                alarm_config: alarmConfig,
              };
            }
            return {
              field_id: field.field_id,
              name: field.name,
              unit: field.unit,
              storage_mode: "log" as StorageMode,
              logging_frequency_seconds: 60,
              enabled: false,
              alarm_config: alarmConfig,
            };
          })
        );

        // Parse status alarm from alarm definitions
        const statusAlarmDef = templateAlarms.find(
          (a) => a.id === "controller_offline" || a.source_type === "heartbeat"
        );
        if (statusAlarmDef) {
          // Find the configured severity from conditions
          const condition = statusAlarmDef.conditions?.[0];
          const severity = condition?.severity || "critical";
          setStatusAlarm({
            enabled: statusAlarmDef.enabled_by_default ?? true,
            offline_severity: severity as "warning" | "minor" | "major" | "critical",
          });
        } else {
          setStatusAlarm({
            enabled: true,
            offline_severity: "critical",
          });
        }

        // Parse site-level alarms from template
        // Always use SITE_LEVEL_ALARMS as source of truth for definitions,
        // only preserve enabled state from saved template data
        const templateSiteLevelAlarms = (template as { site_level_alarms?: SiteLevelAlarm[] }).site_level_alarms;
        setSiteLevelAlarms(
          SITE_LEVEL_ALARMS.map((alarm) => {
            // Find matching saved alarm by ID to preserve enabled state
            const savedAlarm = templateSiteLevelAlarms?.find((a) => a.alarm_id === alarm.alarm_id);
            return {
              ...alarm, // Use current definition (name, description, condition, severity)
              enabled: savedAlarm?.enabled ?? alarm.enabled, // Preserve saved enabled state
            };
          })
        );
      } else {
        // Create mode - reset to defaults
        setFormData({
          name: "",
          description: "",
          hardware_id: "",
          template_type: canCreatePublicTemplate(userRole) ? "public" : "custom",
          enterprise_id: userEnterpriseId || "",
          is_active: true,
        });

        // Reset calculated fields from DB
        if (dbCalculatedFields.length > 0) {
          setCalculatedFields(
            dbCalculatedFields.map((field) => ({
              field_id: field.field_id,
              name: field.name,
              storage_mode: "log" as StorageMode,
              logging_frequency_seconds: field.logging_frequency_seconds || 60,
              enabled: false,
            }))
          );
        }

        // Reset controller readings with default alarm configs
        // All enabled by default with correct frequencies (critical for controller health)
        setControllerReadings(
          CONTROLLER_READINGS.map((field) => ({
            field_id: field.field_id,
            name: field.name,
            unit: field.unit,
            storage_mode: "log" as StorageMode,
            logging_frequency_seconds: field.default_frequency || 600,
            enabled: true, // All enabled by default
            alarm_config: getDefaultAlarmConfig(field.field_id),
          }))
        );

        // Reset status alarm to defaults
        setStatusAlarm({
          enabled: true,
          offline_severity: "critical",
        });

        // Reset site-level alarms to defaults
        setSiteLevelAlarms(SITE_LEVEL_ALARMS.map((alarm) => ({ ...alarm })));
      }
    }
  }, [open, template, isDuplicating, userRole, userEnterpriseId, dbCalculatedFields]);

  // Handle form submission
  const handleSubmit = async () => {
    // Validation
    if (!formData.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!formData.hardware_id) {
      toast.error("Please select a hardware type");
      return;
    }
    // For custom templates, enterprise is required
    if (formData.template_type === "custom" && !formData.enterprise_id) {
      toast.error("Please select an enterprise for custom templates");
      return;
    }

    // Get selected hardware details for brand/model
    const hardware = hardwareOptions.find((h) => h.id === formData.hardware_id);
    if (!hardware) {
      toast.error("Invalid hardware selection");
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createClient();

      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Build calculated_fields array with storage_mode and logging_frequency
      const selectedCalculatedFields = calculatedFields
        .filter((f) => f.enabled)
        .map((f) => ({
          field_id: f.field_id,
          name: f.name,
          storage_mode: f.storage_mode,
          logging_frequency_seconds: f.logging_frequency_seconds,
        }));

      // Build registers array from selected readings with logging frequency
      const selectedRegisters: (SystemRegister & { logging_frequency_seconds?: number })[] = controllerReadings
        .filter((f) => f.enabled)
        .map((f) => {
          const original = CONTROLLER_READINGS.find((r) => r.field_id === f.field_id);
          return {
            name: f.name,
            source: original?.source || "device_info",
            field: f.field_id,
            unit: f.unit || original?.unit || "",
            description: f.name,
            logging_frequency_seconds: f.logging_frequency_seconds,
          };
        });

      // Build alarm definitions from reading alarm configs
      const alarmDefinitions: {
        id: string;
        name: string;
        description: string;
        source_type: string;
        source_key: string;
        conditions: { operator: string; value: number; severity: string; message: string }[];
        enabled_by_default: boolean;
        cooldown_seconds: number;
      }[] = [];

      // Add alarms for enabled controller readings
      controllerReadings.forEach((reading) => {
        if (reading.enabled && reading.alarm_config.enabled) {
          const conditions: { operator: string; value: number; severity: string; message: string }[] = [];

          // Add warning condition if threshold is set
          if (reading.alarm_config.warning_threshold !== null) {
            conditions.push({
              operator: reading.alarm_config.warning_operator,
              value: reading.alarm_config.warning_threshold,
              severity: "warning",
              message: `${reading.name} ${reading.alarm_config.warning_operator} ${reading.alarm_config.warning_threshold}${reading.unit} (Warning)`,
            });
          }

          // Add critical condition if threshold is set
          if (reading.alarm_config.critical_threshold !== null) {
            conditions.push({
              operator: reading.alarm_config.critical_operator,
              value: reading.alarm_config.critical_threshold,
              severity: "critical",
              message: `${reading.name} ${reading.alarm_config.critical_operator} ${reading.alarm_config.critical_threshold}${reading.unit} (Critical)`,
            });
          }

          if (conditions.length > 0) {
            alarmDefinitions.push({
              id: `${reading.field_id}_alarm`,
              name: `${reading.name} Alarm`,
              description: `Threshold alarm for ${reading.name}`,
              source_type: "device_info",
              source_key: reading.field_id,
              conditions,
              enabled_by_default: true,
              cooldown_seconds: 300,
            });
          }
        }
      });

      // Add status alarm (online/offline)
      // Uses fixed 60-second timeout (controller sends heartbeat every 30s, so 2 missed = offline)
      if (statusAlarm.enabled) {
        alarmDefinitions.push({
          id: "controller_offline",
          name: "Controller Offline",
          description: "Alarm when controller goes offline",
          source_type: "heartbeat",
          source_key: "last_heartbeat",
          conditions: [
            {
              operator: ">",
              value: 60,
              severity: statusAlarm.offline_severity,
              message: "Controller offline - no heartbeat received",
            },
          ],
          enabled_by_default: true,
          cooldown_seconds: 60,
        });
      }

      // Generate template_id for new templates, keep existing for edits
      const templateId = isEditing && template
        ? template.template_id
        : generateNumericTemplateId();

      // Derive controller_type from hardware_type
      const controllerType = hardware.hardware_type === "plc"
        ? "plc"
        : hardware.hardware_type === "gateway"
        ? "gateway"
        : "raspberry_pi";

      // Prepare template data
      const templateData = {
        template_id: templateId,
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        controller_type: controllerType,
        hardware_type_id: formData.hardware_id,
        brand: hardware.brand,
        model: hardware.model,
        template_type: formData.template_type,
        enterprise_id:
          formData.template_type === "custom" ? formData.enterprise_id : null,
        created_by: isEditing ? template?.created_by : user?.id,
        registers: selectedRegisters,
        calculated_fields: selectedCalculatedFields,
        alarm_definitions: alarmDefinitions,
        site_level_alarms: siteLevelAlarms,
        is_active: formData.is_active,
      };

      if (isEditing && template) {
        // Update existing template
        const { data, error } = await supabase
          .from("controller_templates")
          .update({
            ...templateData,
            updated_at: new Date().toISOString(),
          })
          .eq("id", template.id)
          .select()
          .single();

        if (error) throw error;
        onSuccess(data as ControllerTemplate);
      } else {
        // Create new template
        const { data, error } = await supabase
          .from("controller_templates")
          .insert(templateData)
          .select()
          .single();

        if (error) throw error;
        onSuccess(data as ControllerTemplate);
      }
    } catch (error) {
      console.error("Error saving template:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to save template";
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle a calculated field
  const toggleCalculatedField = (field_id: string) => {
    setCalculatedFields((prev) =>
      prev.map((f) =>
        f.field_id === field_id ? { ...f, enabled: !f.enabled } : f
      )
    );
  };

  // Update storage mode for a calculated field
  const updateCalculatedFieldMode = (field_id: string, mode: StorageMode) => {
    setCalculatedFields((prev) =>
      prev.map((f) =>
        f.field_id === field_id ? { ...f, storage_mode: mode } : f
      )
    );
  };

  // Update logging frequency for a calculated field
  const updateCalculatedFieldFrequency = (field_id: string, seconds: number) => {
    setCalculatedFields((prev) =>
      prev.map((f) =>
        f.field_id === field_id ? { ...f, logging_frequency_seconds: seconds } : f
      )
    );
  };

  // Get counts
  const enabledCalculatedCount = calculatedFields.filter((f) => f.enabled).length;
  const enabledReadingsCount = controllerReadings.filter((f) => f.enabled).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? "Edit Master Device Template"
              : isDuplicating
              ? "Duplicate Master Device Template"
              : "Create Master Device Template"}
          </DialogTitle>
          <DialogDescription>
            {isDuplicating
              ? "Create a copy of this template. You can modify the details below."
              : "Configure a controller template with calculated fields and health metrics."}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="connection" className="w-full">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="connection" className="text-xs sm:text-sm">Connection</TabsTrigger>
            <TabsTrigger value="controller-fields" className="text-xs sm:text-sm">Controller Fields</TabsTrigger>
            <TabsTrigger value="site-calculations" className="text-xs sm:text-sm">Site Calculations</TabsTrigger>
          </TabsList>

          {/* Connection Tab - Basic Information */}
          <TabsContent value="connection" className="space-y-4 py-4">
            {/* Row 1: Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                placeholder="e.g., Controller X"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            {/* Row 2: Template Type + Enterprise (for custom) */}
            <div className="grid grid-cols-2 gap-4">
              {/* Template Type - only for super_admin/backend_admin */}
              <div className="space-y-2">
                <Label htmlFor="template_type">Template Type *</Label>
                {canCreatePublicTemplate(userRole) ? (
                  <Select
                    value={formData.template_type}
                    onValueChange={(value: "public" | "custom") =>
                      setFormData({ ...formData, template_type: value })
                    }
                  >
                    <SelectTrigger id="template_type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-500" />
                          Public
                        </span>
                      </SelectItem>
                      <SelectItem value="custom">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-blue-500" />
                          Custom
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex items-center gap-2 h-10 px-3 rounded-md border bg-muted/50">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-sm">Custom</span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      (Your Enterprise)
                    </span>
                  </div>
                )}
              </div>

              {/* Enterprise - shown when template_type is "custom" */}
              {formData.template_type === "custom" && (
                <div className="space-y-2">
                  <Label htmlFor="enterprise_id">Enterprise *</Label>
                  {canChangeEnterprise(userRole) ? (
                    // Super admin / backend admin can select any enterprise
                    <Select
                      value={formData.enterprise_id}
                      onValueChange={(value) =>
                        setFormData({ ...formData, enterprise_id: value })
                      }
                      disabled={isLoadingEnterprises}
                    >
                      <SelectTrigger id="enterprise_id">
                        <SelectValue placeholder={isLoadingEnterprises ? "Loading..." : "Select enterprise"} />
                      </SelectTrigger>
                      <SelectContent>
                        {enterpriseOptions.map((enterprise) => (
                          <SelectItem key={enterprise.id} value={enterprise.id}>
                            {enterprise.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    // Enterprise users see their enterprise (read-only)
                    <div className="flex items-center gap-2 h-10 px-3 rounded-md border bg-muted/50">
                      <span className="text-sm">
                        {enterpriseOptions.find((e) => e.id === formData.enterprise_id)?.name || "Your Enterprise"}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Row 3: Active Status Toggle - shown when editing */}
            {isEditing && (
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label htmlFor="is_active" className="text-base font-medium">
                    Active Status
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {formData.is_active
                      ? "Template is active and can be used for new devices"
                      : "Template is inactive and won't appear when adding new devices"}
                  </p>
                </div>
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_active: checked })
                  }
                />
              </div>
            )}

            {/* Row 4: Hardware ID */}
            <div className="space-y-2">
              <Label htmlFor="hardware_id">Hardware *</Label>
              <Select
                value={formData.hardware_id}
                onValueChange={(value) =>
                  setFormData({ ...formData, hardware_id: value })
                }
                disabled={isLoadingHardware}
              >
                <SelectTrigger id="hardware_id">
                  <SelectValue placeholder={isLoadingHardware ? "Loading..." : "Select hardware"} />
                </SelectTrigger>
                <SelectContent>
                  {hardwareOptions.map((hardware) => (
                    <SelectItem key={hardware.id} value={hardware.id}>
                      <span className="flex items-center gap-2">
                        {hardware.name}
                        {!hardware.is_active && (
                          <span className="text-xs text-muted-foreground">(inactive)</span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Select the hardware type for this controller template
              </p>
            </div>

            {/* Row 5: Brand & Model (read-only, auto-populated from hardware) */}
            <div className="grid grid-cols-2 gap-4">
              {/* Brand - Read-only */}
              <div className="space-y-2">
                <Label htmlFor="brand">Brand</Label>
                <Input
                  id="brand"
                  value={selectedHardware?.brand || ""}
                  disabled
                  className="bg-muted/50"
                  placeholder={formData.hardware_id ? "" : "Select hardware first"}
                />
              </div>

              {/* Model - Read-only */}
              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  value={selectedHardware?.model || ""}
                  disabled
                  className="bg-muted/50"
                  placeholder={formData.hardware_id ? "" : "Select hardware first"}
                />
              </div>
            </div>
          </TabsContent>

          {/* Controller Fields Tab */}
          <TabsContent value="controller-fields" className="space-y-4 py-4">
            <div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Controller health metrics (read from system).
                </p>
                <span className="text-xs text-muted-foreground">
                  {enabledReadingsCount} selected
                </span>
              </div>
              {!canEditControllerReadings(userRole) && (
                <p className="text-xs text-amber-600 mt-2">
                  Only Super Admin or Backend Admin can modify controller fields
                </p>
              )}
            </div>

            <ControllerReadingsForm
              readings={controllerReadings}
              onReadingsChange={setControllerReadings}
              statusAlarm={statusAlarm}
              onStatusAlarmChange={setStatusAlarm}
              disabled={!canEditControllerReadings(userRole)}
            />
          </TabsContent>

          {/* Site Calculations Tab - Calculated Fields + Site Alarms */}
          <TabsContent value="site-calculations" className="space-y-6 py-4">
            {/* Section 1: Calculated Fields */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Calculated Fields</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Site-level measurements aggregated from all devices
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {enabledCalculatedCount} selected
                </span>
              </div>

              <div className="border rounded-lg divide-y">
                {isLoadingCalculatedFields ? (
                  <div className="p-4 text-center text-muted-foreground text-sm">
                    Loading calculated fields...
                  </div>
                ) : calculatedFields.length === 0 ? (
                  <div className="p-4 text-center text-muted-foreground text-sm">
                    No calculated fields available
                  </div>
                ) : (
                  calculatedFields.map((field) => {
                    const dbField = dbCalculatedFields.find(
                      (f) => f.field_id === field.field_id
                    );
                    return (
                      <div
                        key={field.field_id}
                        className="flex items-center gap-4 p-3 hover:bg-muted/30"
                      >
                        {/* Checkbox */}
                        <Checkbox
                          id={`calc-${field.field_id}`}
                          checked={field.enabled}
                          onCheckedChange={() => toggleCalculatedField(field.field_id)}
                        />

                        {/* Name and Unit */}
                        <label
                          htmlFor={`calc-${field.field_id}`}
                          className="flex-1 text-sm cursor-pointer"
                        >
                          {field.name}
                          {dbField?.unit && (
                            <span className="text-muted-foreground ml-2">
                              ({dbField.unit})
                            </span>
                          )}
                        </label>

                        {/* Logging Frequency Selector — locked for delta fields */}
                        <Select
                          value={field.logging_frequency_seconds.toString()}
                          onValueChange={(value) =>
                            updateCalculatedFieldFrequency(field.field_id, parseInt(value))
                          }
                          disabled={!field.enabled}
                        >
                          <SelectTrigger className="w-[120px] h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CALC_FIELD_FREQUENCY_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value.toString()}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {/* Storage Mode Selector */}
                        <Select
                          value={field.storage_mode}
                          onValueChange={(value: StorageMode) =>
                            updateCalculatedFieldMode(field.field_id, value)
                          }
                          disabled={!field.enabled}
                        >
                          <SelectTrigger className="w-[120px] h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="log">Log</SelectItem>
                            <SelectItem value="viz_only">Viz Only</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Separator */}
            <div className="border-t" />

            {/* Section 2: Site Alarms */}
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Site Alarms</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Alarms based on site-level calculated values
                </p>
              </div>

              <div className="space-y-2">
                {siteLevelAlarms.map((alarm, index) => (
                  <div
                    key={alarm.alarm_id}
                    className={`p-3 rounded-lg border transition-colors ${
                      alarm.enabled ? "bg-muted/20" : "bg-muted/5 opacity-60"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id={`template-alarm-${alarm.alarm_id}`}
                        checked={alarm.enabled}
                        onCheckedChange={(checked) => {
                          const updated = [...siteLevelAlarms];
                          updated[index] = { ...alarm, enabled: !!checked };
                          setSiteLevelAlarms(updated);
                        }}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <label
                            htmlFor={`template-alarm-${alarm.alarm_id}`}
                            className="font-medium text-sm cursor-pointer"
                          >
                            {alarm.name}
                          </label>
                          <Badge
                            variant="outline"
                            className={`text-xs ${
                              alarm.severity === "critical"
                                ? "border-red-500 text-red-700"
                                : alarm.severity === "warning"
                                ? "border-amber-500 text-amber-700"
                                : "border-blue-500 text-blue-700"
                            }`}
                          >
                            {alarm.severity}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {alarm.description}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Condition: <code className="px-1 py-0.5 bg-muted rounded text-xs">
                            {alarm.source_field} {alarm.condition.operator} {alarm.condition.value}
                          </code>
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting
              ? "Saving..."
              : isEditing
              ? "Save Changes"
              : isDuplicating
              ? "Create Copy"
              : "Create Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
