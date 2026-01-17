"use client";

/**
 * Step 3: Software Setup
 *
 * Guide for setting up the Volteria controller software:
 * - SSH connection via WiFi
 * - NVMe boot setup for SOL564-NVME16-128
 * - One-line install command
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface StepDownloadImageProps {
  onConfirm: (confirmed: boolean) => void;
  confirmed: boolean;
  hardwareType?: string;
  hardwareFeatures?: Record<string, unknown> | null;
}

const SETUP_SCRIPT_URL = "https://raw.githubusercontent.com/byosamah/volteria/main/controller/scripts/setup-controller.sh";
const INSTALL_COMMAND = `curl -sSL ${SETUP_SCRIPT_URL} | sudo bash`;

export function StepDownloadImage({ onConfirm, confirmed, hardwareType, hardwareFeatures }: StepDownloadImageProps) {
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  // Check if hardware requires NVMe boot setup from database features
  const requiresNvmeBoot = hardwareFeatures?.nvme_boot === true;

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(key);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const CommandBox = ({ command, cmdKey, note }: { command: string; cmdKey: string; note?: string }) => (
    <div className="relative">
      <pre className="bg-zinc-900 text-green-400 p-3 pr-20 rounded text-sm font-mono overflow-x-auto">
        {command}
      </pre>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => copyToClipboard(command, cmdKey)}
        className="absolute top-1.5 right-1.5"
      >
        {copiedCmd === cmdKey ? "Copied!" : "Copy"}
      </Button>
      {note && <p className="text-xs text-muted-foreground mt-1">{note}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Step A: SSH Connection */}
      <div className="border rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">A</span>
          <div>
            <h3 className="font-semibold">Connect via SSH</h3>
            <p className="text-sm text-muted-foreground">Your laptop must be on the same WiFi as the Pi</p>
          </div>
        </div>

        <CommandBox
          command="ssh voltadmin@volteria.local"
          cmdKey="ssh"
          note="Password: Solar@1996"
        />
      </div>

      {/* Step B: NVMe Setup - Only for NVMe hardware */}
      {requiresNvmeBoot && (
        <div className="border-2 border-purple-200 rounded-lg p-5 space-y-4 bg-purple-50/30">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold">B</span>
            <div>
              <h3 className="font-semibold text-purple-900">NVMe Boot Setup</h3>
              <p className="text-sm text-purple-700">Configure Pi to boot from NVMe SSD</p>
            </div>
          </div>

          <div className="space-y-4">
            {/* B1 */}
            <div className="bg-white rounded-lg p-4 border border-purple-200">
              <p className="text-sm font-medium text-purple-900 mb-2">B1. Update EEPROM firmware, then reboot</p>
              <CommandBox command="sudo rpi-eeprom-update -a && sudo reboot" cmdKey="eeprom" />
              <p className="text-xs text-purple-700 mt-2">Wait 30s, then SSH back in</p>
            </div>

            {/* B2 */}
            <div className="bg-white rounded-lg p-4 border border-purple-200">
              <p className="text-sm font-medium text-purple-900 mb-2">B2. Set boot order to NVMe</p>
              <CommandBox command="sudo raspi-config" cmdKey="raspi" />
              <div className="bg-purple-100 rounded p-2 mt-2 text-xs text-purple-800">
                Navigate: <code>Advanced Options → Boot Order → NVMe/USB Boot → OK → Finish → No</code>
              </div>
            </div>

            {/* B3 */}
            <div className="bg-white rounded-lg p-4 border border-purple-200">
              <p className="text-sm font-medium text-purple-900 mb-2">B3. Clone SD to NVMe (5-15 minutes)</p>
              <CommandBox command="sudo dd if=/dev/mmcblk0 of=/dev/nvme0n1 bs=4M status=progress" cmdKey="clone" />
              <p className="text-xs text-amber-700 mt-2 font-medium">Wait for completion - do not interrupt!</p>
            </div>

            {/* B4 */}
            <div className="bg-white rounded-lg p-4 border border-purple-200">
              <p className="text-sm font-medium text-purple-900 mb-2">B4. Shutdown, remove SD card, power on</p>
              <CommandBox command="sudo shutdown -h now" cmdKey="shutdown" />
              <div className="bg-amber-50 border border-amber-200 rounded p-3 mt-2 text-xs text-amber-800 space-y-2">
                <p className="font-medium">LED Guide:</p>
                <ul className="space-y-1 ml-2">
                  <li>• <span className="text-red-600 font-medium">Red LED</span> = Power (stays on while plugged in)</li>
                  <li>• <span className="text-green-600 font-medium">Green LED</span> = Activity (stops blinking when shutdown complete)</li>
                </ul>
              </div>
              <div className="bg-green-50 border border-green-200 rounded p-3 mt-2 text-xs text-green-800">
                <p className="font-medium mb-1">Physical steps:</p>
                <ol className="space-y-1 ml-2 list-decimal list-inside">
                  <li>Wait for <span className="text-green-600 font-medium">green LED</span> to stop blinking</li>
                  <li>Unplug power cable</li>
                  <li>Remove SD card (keep it as recovery backup)</li>
                  <li>Plug power back in</li>
                </ol>
              </div>
              <p className="text-xs text-purple-700 mt-2">Wait 60-90s, then SSH back in. Pi now boots from NVMe!</p>
            </div>
          </div>
        </div>
      )}

      {/* Step C: Run Setup Script */}
      <div className="border-2 border-green-200 rounded-lg p-5 space-y-4 bg-green-50/30">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold">C</span>
          <div>
            <h3 className="font-semibold text-green-900">Run Setup Script</h3>
            <p className="text-sm text-green-700">Installs all Volteria controller software (5-10 minutes)</p>
          </div>
        </div>

        <CommandBox command={INSTALL_COMMAND} cmdKey="install" />

        {/* What gets installed */}
        <div className="bg-white border border-green-200 rounded-lg p-4 space-y-3">
          <h4 className="font-medium text-green-900">What the script installs:</h4>
          <ul className="text-sm space-y-2 text-green-800">
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Python 3.11 with pymodbus, supabase, and dependencies
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <span className="font-medium">5-Layer Service Architecture:</span>
                <ul className="mt-1 ml-4 space-y-0.5 text-xs text-green-700">
                  <li><code className="bg-green-100 px-1 rounded">volteria-system</code> - Heartbeat, OTA updates, health monitoring</li>
                  <li><code className="bg-green-100 px-1 rounded">volteria-config</code> - Cloud sync, versioning, local cache</li>
                  <li><code className="bg-green-100 px-1 rounded">volteria-device</code> - Modbus I/O, polling, writes</li>
                  <li><code className="bg-green-100 px-1 rounded">volteria-control</code> - Zero-feeding algorithm</li>
                  <li><code className="bg-green-100 px-1 rounded">volteria-logging</code> - Data logging, cloud sync, alarms</li>
                </ul>
              </div>
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span><span className="font-medium">SSH Tunnel Service</span> <span className="text-xs">(autossh for remote access)</span></span>
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Local SQLite database for offline operation
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Configuration at /etc/volteria/config.yaml
            </li>
          </ul>
        </div>

        {/* GitHub link */}
        <a
          href="https://github.com/byosamah/volteria/tree/main/controller"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full p-3 border rounded-lg hover:bg-muted/50 text-sm font-medium"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          View Release on GitHub
        </a>
      </div>

      {/* Confirmation */}
      <label className="flex items-center gap-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/50">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirm(e.target.checked)}
          className="w-5 h-5 rounded border-gray-300"
        />
        <span className="text-sm">
          I have completed the setup and the script finished successfully
        </span>
      </label>
    </div>
  );
}
