"use client";

/**
 * Controller Templates List Component
 *
 * Client component for displaying and managing controller templates.
 * Includes create/edit dialog with:
 * - Basic info (template_id, name, controller_type)
 * - System registers for logging
 * - Alarm definitions with threshold conditions
 * - Calculated field selection
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import type {
  ControllerTemplate,
  AlarmDefinition,
  AlarmCondition,
  SystemRegister,
} from "@/lib/types";

// Props for the list component
interface ControllerTemplatesListProps {
  templates: ControllerTemplate[];
  calculatedFields: Array<{ field_id: string; name: string; scope: string }>;
  approvedHardware: Array<{ id: string; name: string; hardware_type: string }>;
}

// Controller type labels and colors
const controllerTypeLabels: Record<string, string> = {
  raspberry_pi: "Raspberry Pi",
  gateway: "Gateway",
  plc: "PLC",
};

const controllerTypeColors: Record<string, string> = {
  raspberry_pi: "bg-green-100 text-green-800",
  gateway: "bg-purple-100 text-purple-800",
  plc: "bg-orange-100 text-orange-800",
};

// Controller type for form data
type ControllerTypeValue = "raspberry_pi" | "gateway" | "plc";

// Form data interface
interface FormData {
  template_id: string;
  name: string;
  description: string;
  controller_type: ControllerTypeValue;
  hardware_type_id: string;
  brand: string;
  model: string;
}

// Empty form data for new templates
const emptyFormData: FormData = {
  template_id: "",
  name: "",
  description: "",
  controller_type: "raspberry_pi",
  hardware_type_id: "",
  brand: "",
  model: "",
};

// Empty alarm definition
const emptyAlarmDefinition: AlarmDefinition = {
  id: "",
  name: "",
  description: "",
  source_type: "device_info",
  source_key: "",
  conditions: [],
  enabled_by_default: true,
  cooldown_seconds: 300,
};

// Empty alarm condition
const emptyCondition: AlarmCondition = {
  operator: ">",
  value: 0,
  severity: "warning",
  message: "",
};

// Empty system register
const emptyRegister: SystemRegister = {
  name: "",
  source: "device_info",
  field: "",
  unit: "",
  description: "",
};

// Section header component with collapsible trigger
function SectionHeader({
  title,
  count,
  isOpen,
  onToggle,
}: {
  title: string;
  count?: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <CollapsibleTrigger asChild onClick={onToggle}>
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-lg bg-muted/50 px-4 py-3 text-left text-sm font-medium hover:bg-muted transition-colors"
      >
        <span className="flex items-center gap-2">
          {title}
          {count !== undefined && (
            <Badge variant="secondary" className="text-xs">
              {count}
            </Badge>
          )}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </CollapsibleTrigger>
  );
}

// Alarm condition editor row
function ConditionRow({
  condition,
  index,
  onChange,
  onRemove,
}: {
  condition: AlarmCondition;
  index: number;
  onChange: (index: number, field: keyof AlarmCondition, value: unknown) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 items-center p-2 bg-muted/30 rounded-lg">
      <select
        value={condition.operator}
        onChange={(e) => onChange(index, "operator", e.target.value)}
        className="h-9 px-2 rounded border bg-background text-sm w-16"
      >
        <option value=">">&gt;</option>
        <option value=">=">&gt;=</option>
        <option value="<">&lt;</option>
        <option value="<=">&lt;=</option>
        <option value="==">==</option>
        <option value="!=">!=</option>
      </select>
      <Input
        type="number"
        value={condition.value}
        onChange={(e) => onChange(index, "value", parseFloat(e.target.value) || 0)}
        className="h-9 w-20"
        placeholder="Value"
      />
      <select
        value={condition.severity}
        onChange={(e) => onChange(index, "severity", e.target.value)}
        className="h-9 px-2 rounded border bg-background text-sm w-24"
      >
        <option value="info">Info</option>
        <option value="warning">Warning</option>
        <option value="major">Major</option>
        <option value="critical">Critical</option>
      </select>
      <Input
        value={condition.message}
        onChange={(e) => onChange(index, "message", e.target.value)}
        className="h-9 flex-1 min-w-[150px]"
        placeholder="Alert message..."
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-9 w-9 p-0 text-destructive hover:text-destructive"
        onClick={() => onRemove(index)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </Button>
    </div>
  );
}

// Alarm definition editor card
function AlarmDefinitionEditor({
  alarm,
  index,
  onChange,
  onRemove,
}: {
  alarm: AlarmDefinition;
  index: number;
  onChange: (index: number, alarm: AlarmDefinition) => void;
  onRemove: (index: number) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);

  const updateField = <K extends keyof AlarmDefinition>(field: K, value: AlarmDefinition[K]) => {
    onChange(index, { ...alarm, [field]: value });
  };

  const updateCondition = (condIndex: number, field: keyof AlarmCondition, value: unknown) => {
    const newConditions = [...alarm.conditions];
    newConditions[condIndex] = { ...newConditions[condIndex], [field]: value };
    onChange(index, { ...alarm, conditions: newConditions });
  };

  const addCondition = () => {
    onChange(index, {
      ...alarm,
      conditions: [...alarm.conditions, { ...emptyCondition }],
    });
  };

  const removeCondition = (condIndex: number) => {
    const newConditions = alarm.conditions.filter((_, i) => i !== condIndex);
    onChange(index, { ...alarm, conditions: newConditions });
  };

  return (
    <Card className="border-l-4 border-l-amber-500">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <CollapsibleTrigger className="flex items-center gap-2 hover:text-primary">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
              <span className="font-medium">{alarm.name || "New Alarm"}</span>
              <Badge variant="outline" className="text-xs">
                {alarm.conditions.length} condition{alarm.conditions.length !== 1 ? "s" : ""}
              </Badge>
            </CollapsibleTrigger>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => onRemove(index)}
            >
              Remove
            </Button>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            {/* Basic Info Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Alarm ID</Label>
                <Input
                  value={alarm.id}
                  onChange={(e) => updateField("id", e.target.value.toLowerCase().replace(/\s+/g, "_"))}
                  placeholder="e.g., high_cpu_temp"
                  className="h-9 font-mono text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={alarm.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="e.g., High CPU Temperature"
                  className="h-9"
                />
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input
                value={alarm.description}
                onChange={(e) => updateField("description", e.target.value)}
                placeholder="Brief description of what this alarm monitors..."
                className="h-9"
              />
            </div>

            {/* Source Config Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Source Type</Label>
                <select
                  value={alarm.source_type}
                  onChange={(e) => updateField("source_type", e.target.value as AlarmDefinition["source_type"])}
                  className="h-9 w-full px-2 rounded border bg-background text-sm"
                >
                  <option value="device_info">Device Info</option>
                  <option value="heartbeat">Heartbeat</option>
                  <option value="modbus_register">Modbus Register</option>
                  <option value="calculated_field">Calculated Field</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Source Key</Label>
                <Input
                  value={alarm.source_key}
                  onChange={(e) => updateField("source_key", e.target.value)}
                  placeholder="e.g., cpu_temp_celsius"
                  className="h-9 font-mono text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cooldown (seconds)</Label>
                <Input
                  type="number"
                  value={alarm.cooldown_seconds}
                  onChange={(e) => updateField("cooldown_seconds", parseInt(e.target.value) || 0)}
                  className="h-9"
                  min={0}
                />
              </div>
            </div>

            {/* Enabled by Default */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id={`enabled-${index}`}
                checked={alarm.enabled_by_default}
                onCheckedChange={(checked) => updateField("enabled_by_default", !!checked)}
              />
              <Label htmlFor={`enabled-${index}`} className="text-sm cursor-pointer">
                Enabled by default when added to site
              </Label>
            </div>

            {/* Conditions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Threshold Conditions</Label>
                <Button type="button" variant="outline" size="sm" onClick={addCondition}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 mr-1">
                    <path d="M5 12h14" />
                    <path d="M12 5v14" />
                  </svg>
                  Add Condition
                </Button>
              </div>
              <div className="space-y-2">
                {alarm.conditions.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">
                    No conditions defined. Add at least one condition.
                  </p>
                ) : (
                  alarm.conditions.map((condition, condIndex) => (
                    <ConditionRow
                      key={condIndex}
                      condition={condition}
                      index={condIndex}
                      onChange={updateCondition}
                      onRemove={removeCondition}
                    />
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// System register editor row
function RegisterRow({
  register,
  index,
  onChange,
  onRemove,
}: {
  register: SystemRegister;
  index: number;
  onChange: (index: number, register: SystemRegister) => void;
  onRemove: (index: number) => void;
}) {
  const updateField = <K extends keyof SystemRegister>(field: K, value: SystemRegister[K]) => {
    onChange(index, { ...register, [field]: value });
  };

  return (
    <div className="flex flex-wrap gap-2 items-center p-2 bg-muted/30 rounded-lg">
      <Input
        value={register.name}
        onChange={(e) => updateField("name", e.target.value.toLowerCase().replace(/\s+/g, "_"))}
        className="h-9 w-28 font-mono text-sm"
        placeholder="name"
      />
      <select
        value={register.source}
        onChange={(e) => updateField("source", e.target.value as SystemRegister["source"])}
        className="h-9 px-2 rounded border bg-background text-sm w-28"
      >
        <option value="device_info">device_info</option>
        <option value="calculated">calculated</option>
      </select>
      <Input
        value={register.field}
        onChange={(e) => updateField("field", e.target.value)}
        className="h-9 w-32 font-mono text-sm"
        placeholder="field"
      />
      <Input
        value={register.unit}
        onChange={(e) => updateField("unit", e.target.value)}
        className="h-9 w-16"
        placeholder="unit"
      />
      <Input
        value={register.description || ""}
        onChange={(e) => updateField("description", e.target.value)}
        className="h-9 flex-1 min-w-[120px]"
        placeholder="Description..."
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-9 w-9 p-0 text-destructive hover:text-destructive"
        onClick={() => onRemove(index)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </Button>
    </div>
  );
}

export function ControllerTemplatesList({
  templates: initialTemplates,
  calculatedFields,
  approvedHardware,
}: ControllerTemplatesListProps) {
  const router = useRouter();
  const supabase = createClient();

  const [templates, setTemplates] = useState(initialTemplates);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<ControllerTemplate | null>(null);
  const [loading, setLoading] = useState(false);

  // Form state
  const [formData, setFormData] = useState(emptyFormData);
  const [registers, setRegisters] = useState<SystemRegister[]>([]);
  const [alarmDefinitions, setAlarmDefinitions] = useState<AlarmDefinition[]>([]);
  const [selectedCalculatedFields, setSelectedCalculatedFields] = useState<string[]>([]);

  // Section open/close state
  const [openSections, setOpenSections] = useState({
    basic: true,
    registers: false,
    alarms: true,
    calculatedFields: false,
  });

  // Toggle section
  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Reset form
  const resetForm = () => {
    setFormData(emptyFormData);
    setRegisters([]);
    setAlarmDefinitions([]);
    setSelectedCalculatedFields([]);
    setOpenSections({
      basic: true,
      registers: false,
      alarms: true,
      calculatedFields: false,
    });
  };

  // Open edit dialog
  const openEditDialog = (template: ControllerTemplate) => {
    setEditTemplate(template);
    setFormData({
      template_id: template.template_id,
      name: template.name,
      description: template.description || "",
      controller_type: template.controller_type,
      hardware_type_id: template.hardware_type_id || "",
      brand: template.brand || "",
      model: template.model || "",
    });
    setRegisters(template.registers || []);
    setAlarmDefinitions(template.alarm_definitions || []);
    setSelectedCalculatedFields(template.calculated_fields || []);
    setOpenSections({
      basic: true,
      registers: (template.registers?.length || 0) > 0,
      alarms: true,
      calculatedFields: (template.calculated_fields?.length || 0) > 0,
    });
  };

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Add new register
  const addRegister = () => {
    setRegisters((prev) => [...prev, { ...emptyRegister }]);
  };

  // Update register
  const updateRegister = (index: number, register: SystemRegister) => {
    setRegisters((prev) => prev.map((r, i) => (i === index ? register : r)));
  };

  // Remove register
  const removeRegister = (index: number) => {
    setRegisters((prev) => prev.filter((_, i) => i !== index));
  };

  // Add new alarm definition
  const addAlarmDefinition = () => {
    setAlarmDefinitions((prev) => [
      ...prev,
      {
        ...emptyAlarmDefinition,
        id: `alarm_${Date.now()}`,
        conditions: [{ ...emptyCondition }],
      },
    ]);
  };

  // Update alarm definition
  const updateAlarmDefinition = (index: number, alarm: AlarmDefinition) => {
    setAlarmDefinitions((prev) => prev.map((a, i) => (i === index ? alarm : a)));
  };

  // Remove alarm definition
  const removeAlarmDefinition = (index: number) => {
    setAlarmDefinitions((prev) => prev.filter((_, i) => i !== index));
  };

  // Toggle calculated field selection
  const toggleCalculatedField = (fieldId: string) => {
    setSelectedCalculatedFields((prev) =>
      prev.includes(fieldId) ? prev.filter((f) => f !== fieldId) : [...prev, fieldId]
    );
  };

  // Handle create/edit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validation
      if (!formData.template_id.trim()) {
        toast.error("Template ID is required");
        setLoading(false);
        return;
      }

      if (!formData.name.trim()) {
        toast.error("Display name is required");
        setLoading(false);
        return;
      }

      // Validate alarm definitions have IDs
      const invalidAlarms = alarmDefinitions.filter((a) => !a.id.trim());
      if (invalidAlarms.length > 0) {
        toast.error("All alarm definitions must have an ID");
        setLoading(false);
        return;
      }

      // Build template data object
      const templateData = {
        template_id: formData.template_id.trim().toLowerCase().replace(/\s+/g, "_"),
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        controller_type: formData.controller_type,
        hardware_type_id: formData.hardware_type_id || null,
        brand: formData.brand.trim() || null,
        model: formData.model.trim() || null,
        registers: registers.filter((r) => r.name.trim()),
        alarm_definitions: alarmDefinitions.filter((a) => a.id.trim()),
        calculated_fields: selectedCalculatedFields,
        template_type: "master" as const,
        is_active: true,
      };

      if (editTemplate) {
        // Update existing
        const { error } = await supabase
          .from("controller_templates")
          .update(templateData)
          .eq("id", editTemplate.id);

        if (error) {
          toast.error(error.message || "Failed to update template");
          setLoading(false);
          return;
        }

        toast.success("Template updated successfully");
        setTemplates(
          templates.map((t) =>
            t.id === editTemplate.id ? { ...t, ...templateData } : t
          )
        );
        setEditTemplate(null);
      } else {
        // Create new
        const { data, error } = await supabase
          .from("controller_templates")
          .insert(templateData)
          .select()
          .single();

        if (error) {
          if (error.code === "23505") {
            toast.error("Template ID already exists");
          } else {
            toast.error(error.message || "Failed to create template");
          }
          setLoading(false);
          return;
        }

        toast.success("Template created successfully");
        setTemplates([...templates, data]);
        setCreateOpen(false);
        resetForm();
      }

      router.refresh();
    } catch (err) {
      console.error("Unexpected error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Toggle active status
  const toggleActive = async (template: ControllerTemplate) => {
    const { error } = await supabase
      .from("controller_templates")
      .update({ is_active: !template.is_active })
      .eq("id", template.id);

    if (error) {
      toast.error("Failed to update status");
      return;
    }

    setTemplates(
      templates.map((t) =>
        t.id === template.id ? { ...t, is_active: !t.is_active } : t
      )
    );

    toast.success(
      template.is_active ? "Template deactivated" : "Template activated"
    );
  };

  // Filter controller-level calculated fields only
  const controllerLevelFields = calculatedFields.filter((f) => f.scope === "controller");

  return (
    <>
      {/* Actions */}
      <div className="flex justify-end">
        <Button
          onClick={() => {
            resetForm();
            setCreateOpen(true);
          }}
          className="min-h-[44px]"
        >
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
          Add Controller Template
        </Button>
      </div>

      {/* Templates Grid */}
      {templates.length === 0 ? (
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
                <rect width="20" height="14" x="2" y="3" rx="2" />
                <line x1="8" x2="16" y1="21" y2="21" />
                <line x1="12" x2="12" y1="17" y2="21" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">No controller templates</h3>
            <p className="text-muted-foreground text-center max-w-sm">
              Create your first controller template to define alarm thresholds and system registers.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <Card
              key={template.id}
              className={!template.is_active ? "opacity-60" : ""}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{template.name}</CardTitle>
                    <CardDescription className="font-mono text-xs">
                      {template.template_id}
                    </CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge className={controllerTypeColors[template.controller_type]}>
                      {controllerTypeLabels[template.controller_type]}
                    </Badge>
                    <Badge variant={template.is_active ? "default" : "secondary"}>
                      {template.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {template.description && (
                  <p className="text-sm text-muted-foreground">{template.description}</p>
                )}

                {template.brand && (
                  <p className="text-sm">
                    {template.brand} {template.model}
                  </p>
                )}

                {/* Stats badges */}
                <div className="flex flex-wrap gap-2">
                  {(template.registers?.length || 0) > 0 && (
                    <Badge variant="outline" className="text-xs">
                      {template.registers?.length} registers
                    </Badge>
                  )}
                  {(template.alarm_definitions?.length || 0) > 0 && (
                    <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700">
                      {template.alarm_definitions?.length} alarms
                    </Badge>
                  )}
                  {(template.calculated_fields?.length || 0) > 0 && (
                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700">
                      {template.calculated_fields?.length} calculated
                    </Badge>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditDialog(template)}
                    className="flex-1"
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleActive(template)}
                  >
                    {template.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog
        open={createOpen || !!editTemplate}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditTemplate(null);
            resetForm();
          }
        }}
      >
        <DialogContent className="mx-4 max-w-[calc(100%-2rem)] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editTemplate ? "Edit Controller Template" : "Add Controller Template"}
            </DialogTitle>
            <DialogDescription>
              {editTemplate
                ? "Update the controller template with registers and alarm definitions."
                : "Create a new controller template with system registers and alarm thresholds."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            {/* Section 1: Basic Info */}
            <Collapsible open={openSections.basic}>
              <SectionHeader
                title="Basic Information"
                isOpen={openSections.basic}
                onToggle={() => toggleSection("basic")}
              />
              <CollapsibleContent className="pt-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="template_id" className="text-xs">
                      Template ID <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="template_id"
                      name="template_id"
                      placeholder="e.g., rpi5_standard"
                      value={formData.template_id}
                      onChange={handleChange}
                      className="min-h-[44px] font-mono"
                      disabled={!!editTemplate}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="name" className="text-xs">
                      Display Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="name"
                      name="name"
                      placeholder="e.g., Raspberry Pi 5 Standard"
                      value={formData.name}
                      onChange={handleChange}
                      className="min-h-[44px]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="controller_type" className="text-xs">
                      Controller Type
                    </Label>
                    <select
                      id="controller_type"
                      name="controller_type"
                      value={formData.controller_type}
                      onChange={handleChange}
                      className="min-h-[44px] w-full px-3 rounded-md border bg-background"
                    >
                      <option value="raspberry_pi">Raspberry Pi</option>
                      <option value="gateway">Gateway</option>
                      <option value="plc">PLC</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="hardware_type_id" className="text-xs">
                      Linked Hardware
                    </Label>
                    <select
                      id="hardware_type_id"
                      name="hardware_type_id"
                      value={formData.hardware_type_id}
                      onChange={handleChange}
                      className="min-h-[44px] w-full px-3 rounded-md border bg-background"
                    >
                      <option value="">None</option>
                      {approvedHardware.map((hw) => (
                        <option key={hw.id} value={hw.id}>
                          {hw.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="brand" className="text-xs">
                      Brand
                    </Label>
                    <Input
                      id="brand"
                      name="brand"
                      placeholder="e.g., Raspberry Pi"
                      value={formData.brand}
                      onChange={handleChange}
                      className="min-h-[44px]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="model" className="text-xs">
                      Model
                    </Label>
                    <Input
                      id="model"
                      name="model"
                      placeholder="e.g., Pi 5"
                      value={formData.model}
                      onChange={handleChange}
                      className="min-h-[44px]"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description" className="text-xs">
                    Description
                  </Label>
                  <Input
                    id="description"
                    name="description"
                    placeholder="Brief description of this controller template..."
                    value={formData.description}
                    onChange={handleChange}
                    className="min-h-[44px]"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Section 2: System Registers */}
            <Collapsible open={openSections.registers}>
              <SectionHeader
                title="System Registers"
                count={registers.length}
                isOpen={openSections.registers}
                onToggle={() => toggleSection("registers")}
              />
              <CollapsibleContent className="pt-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Define system metrics that the controller will log (CPU temp, disk usage, etc.)
                </p>
                {registers.length > 0 && (
                  <div className="space-y-2">
                    {registers.map((register, index) => (
                      <RegisterRow
                        key={index}
                        register={register}
                        index={index}
                        onChange={updateRegister}
                        onRemove={removeRegister}
                      />
                    ))}
                  </div>
                )}
                <Button type="button" variant="outline" size="sm" onClick={addRegister}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 mr-1">
                    <path d="M5 12h14" />
                    <path d="M12 5v14" />
                  </svg>
                  Add Register
                </Button>
              </CollapsibleContent>
            </Collapsible>

            {/* Section 3: Alarm Definitions */}
            <Collapsible open={openSections.alarms}>
              <SectionHeader
                title="Alarm Definitions"
                count={alarmDefinitions.length}
                isOpen={openSections.alarms}
                onToggle={() => toggleSection("alarms")}
              />
              <CollapsibleContent className="pt-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Define alarms with threshold conditions. These can be customized per-site.
                </p>
                {alarmDefinitions.length > 0 && (
                  <div className="space-y-3">
                    {alarmDefinitions.map((alarm, index) => (
                      <AlarmDefinitionEditor
                        key={index}
                        alarm={alarm}
                        index={index}
                        onChange={updateAlarmDefinition}
                        onRemove={removeAlarmDefinition}
                      />
                    ))}
                  </div>
                )}
                <Button type="button" variant="outline" size="sm" onClick={addAlarmDefinition}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 mr-1">
                    <path d="M5 12h14" />
                    <path d="M12 5v14" />
                  </svg>
                  Add Alarm Definition
                </Button>
              </CollapsibleContent>
            </Collapsible>

            {/* Section 4: Calculated Fields */}
            <Collapsible open={openSections.calculatedFields}>
              <SectionHeader
                title="Calculated Fields"
                count={selectedCalculatedFields.length}
                isOpen={openSections.calculatedFields}
                onToggle={() => toggleSection("calculatedFields")}
              />
              <CollapsibleContent className="pt-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Select which calculated fields this controller should compute and log.
                </p>
                {controllerLevelFields.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">
                    No calculated fields available. Run migrations to seed default fields.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {controllerLevelFields.map((field) => (
                      <div key={field.field_id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`calc-${field.field_id}`}
                          checked={selectedCalculatedFields.includes(field.field_id)}
                          onCheckedChange={() => toggleCalculatedField(field.field_id)}
                        />
                        <Label
                          htmlFor={`calc-${field.field_id}`}
                          className="text-sm cursor-pointer flex items-center gap-2"
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            {field.field_id}
                          </span>
                          <span>{field.name}</span>
                        </Label>
                      </div>
                    ))}
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>

            <DialogFooter className="flex-col gap-2 sm:flex-row pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreateOpen(false);
                  setEditTemplate(null);
                  resetForm();
                }}
                className="min-h-[44px] w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading} className="min-h-[44px] w-full sm:w-auto">
                {loading
                  ? editTemplate
                    ? "Saving..."
                    : "Creating..."
                  : editTemplate
                    ? "Save Changes"
                    : "Create Template"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
