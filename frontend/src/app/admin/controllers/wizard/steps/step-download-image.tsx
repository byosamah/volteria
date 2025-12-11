"use client";

/**
 * Step 2: Software Setup
 *
 * Guide for setting up the Volteria controller software:
 * - Hardware-specific instructions based on selected hardware type
 * - NVMe boot setup for SOL564-NVME16-128
 * - One-line install command
 * - Requirements checklist
 * - What gets installed
 * - Confirmation checkbox
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface StepDownloadImageProps {
  onConfirm: (confirmed: boolean) => void;
  confirmed: boolean;
  // Hardware type from Step 1 selection - determines which instructions to show
  hardwareType?: string;
}

// Hardware types that require NVMe boot setup
const NVME_HARDWARE_TYPES = ["SOL564-NVME16-128"];

// Setup configuration
const SETUP_CONFIG = {
  version: "1.0.0",
  releaseUrl: "https://github.com/byosamah/volteria/releases/tag/v1.0.0-controller",
  scriptUrl: "https://github.com/byosamah/volteria/releases/download/v1.0.0-controller/setup-controller.sh",
  docsUrl: "https://github.com/byosamah/volteria/blob/main/controller/scripts/README-CONTROLLER.md",
};

// One-line install command
const INSTALL_COMMAND = `curl -sSL ${SETUP_CONFIG.scriptUrl} | bash`;

export function StepDownloadImage({ onConfirm, confirmed, hardwareType }: StepDownloadImageProps) {
  const [copied, setCopied] = useState(false);
  const [nvmeCopied, setNvmeCopied] = useState<string | null>(null);

  // Check if this hardware type requires NVMe boot setup
  const requiresNvmeBoot = hardwareType && NVME_HARDWARE_TYPES.includes(hardwareType);

  // NVMe setup commands
  const NVME_COMMANDS = {
    eepromUpdate: "sudo rpi-eeprom-update -a",
    raspiConfig: "sudo raspi-config",
    cloneToDisk: "sudo dd if=/dev/mmcblk0 of=/dev/nvme0n1 bs=4M status=progress",
    expandFilesystem: "sudo raspi-config --expand-rootfs",
    reboot: "sudo reboot",
  };

  // Copy NVMe command to clipboard
  const handleCopyNvmeCommand = (command: string, key: string) => {
    navigator.clipboard.writeText(command);
    setNvmeCopied(key);
    setTimeout(() => setNvmeCopied(null), 2000);
  };

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(INSTALL_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleViewRelease = () => {
    window.open(SETUP_CONFIG.releaseUrl, "_blank");
  };

  return (
    <div className="space-y-6">
      {/* Introduction */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-800 mb-2">Automated Setup Script</h3>
        <p className="text-sm text-blue-700">
          We provide a setup script that automatically installs everything needed
          to run the Volteria controller on your Raspberry Pi. Just run one command!
        </p>
      </div>

      {/* NVMe Hardware Info Banner - Only shown for NVMe hardware types */}
      {requiresNvmeBoot && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-purple-800 mb-1">NVMe SSD Hardware Detected</h3>
              <p className="text-sm text-purple-700">
                Your hardware (<code className="bg-purple-100 px-1 rounded">{hardwareType}</code>) includes an NVMe SSD.
                This guide includes additional steps to configure NVMe boot for faster performance.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Prerequisites */}
      <div className="border rounded-lg p-6 space-y-4">
        <h3 className="font-semibold text-lg">Before You Begin</h3>
        <p className="text-sm text-muted-foreground">
          Make sure you have completed these steps:
        </p>
        <ul className="text-sm space-y-2">
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs font-bold">1</span>
            <div>
              <span className="font-medium">Flash Raspberry Pi OS Lite (64-bit)</span>
              <p className="text-muted-foreground">
                Use <a href="https://www.raspberrypi.com/software/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Raspberry Pi Imager</a> to flash the OS to your SD card.
                Enable SSH in the settings before flashing.
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs font-bold">2</span>
            <div>
              <span className="font-medium">Boot and connect via SSH</span>
              <p className="text-muted-foreground">
                Insert the SD card, connect Ethernet, power on, then SSH in:
                <code className="bg-muted px-1 rounded ml-1">ssh pi@raspberrypi.local</code>
              </p>
            </div>
          </li>
        </ul>
      </div>

      {/* NVMe Boot Setup - Only shown for NVMe hardware types */}
      {requiresNvmeBoot && (
        <div className="border-2 border-purple-200 rounded-lg p-6 space-y-4 bg-purple-50/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
              NVMe
            </div>
            <div>
              <h3 className="font-semibold text-lg text-purple-900">NVMe Boot Setup</h3>
              <p className="text-sm text-purple-700">
                Configure your Pi to boot from the NVMe SSD for faster performance
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {/* Step 1: Update EEPROM */}
            <div className="bg-white rounded-lg p-4 border border-purple-200">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</span>
                <div className="flex-1 space-y-2">
                  <span className="font-medium text-purple-900">Update EEPROM firmware</span>
                  <p className="text-sm text-purple-700">
                    Run this command to update the bootloader firmware:
                  </p>
                  <div className="relative">
                    <pre className="bg-zinc-900 text-green-400 p-3 rounded text-sm font-mono overflow-x-auto">
                      {NVME_COMMANDS.eepromUpdate}
                    </pre>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleCopyNvmeCommand(NVME_COMMANDS.eepromUpdate, "eeprom")}
                      className="absolute top-1 right-1"
                    >
                      {nvmeCopied === "eeprom" ? "Copied!" : "Copy"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2: Configure Boot Order */}
            <div className="bg-white rounded-lg p-4 border border-purple-200">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</span>
                <div className="flex-1 space-y-2">
                  <span className="font-medium text-purple-900">Set NVMe as boot device</span>
                  <p className="text-sm text-purple-700">
                    Open the configuration tool:
                  </p>
                  <div className="relative">
                    <pre className="bg-zinc-900 text-green-400 p-3 rounded text-sm font-mono overflow-x-auto">
                      {NVME_COMMANDS.raspiConfig}
                    </pre>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleCopyNvmeCommand(NVME_COMMANDS.raspiConfig, "config")}
                      className="absolute top-1 right-1"
                    >
                      {nvmeCopied === "config" ? "Copied!" : "Copy"}
                    </Button>
                  </div>
                  <div className="bg-purple-100 rounded p-3 text-sm text-purple-800">
                    <p className="font-medium mb-1">Navigate to:</p>
                    <code className="text-xs">Advanced Options → Boot Order → NVMe/USB Boot</code>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 3: Clone to NVMe */}
            <div className="bg-white rounded-lg p-4 border border-purple-200">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold">3</span>
                <div className="flex-1 space-y-2">
                  <span className="font-medium text-purple-900">Clone SD card to NVMe SSD</span>
                  <p className="text-sm text-purple-700">
                    Copy your entire SD card to the NVMe SSD (takes 5-15 minutes):
                  </p>
                  <div className="relative">
                    <pre className="bg-zinc-900 text-green-400 p-3 rounded text-sm font-mono overflow-x-auto">
                      {NVME_COMMANDS.cloneToDisk}
                    </pre>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleCopyNvmeCommand(NVME_COMMANDS.cloneToDisk, "clone")}
                      className="absolute top-1 right-1"
                    >
                      {nvmeCopied === "clone" ? "Copied!" : "Copy"}
                    </Button>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800">
                    <p className="font-medium">Wait for completion!</p>
                    <p>This command shows progress. Wait until it finishes before proceeding.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 4: Remove SD and Reboot */}
            <div className="bg-white rounded-lg p-4 border border-purple-200">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-purple-600 text-white rounded-full flex items-center justify-center text-xs font-bold">4</span>
                <div className="flex-1 space-y-2">
                  <span className="font-medium text-purple-900">Remove SD card and reboot</span>
                  <p className="text-sm text-purple-700">
                    Shutdown the Pi, physically remove the SD card, then power on to boot from NVMe:
                  </p>
                  <div className="relative">
                    <pre className="bg-zinc-900 text-green-400 p-3 rounded text-sm font-mono overflow-x-auto">
                      sudo shutdown -h now
                    </pre>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleCopyNvmeCommand("sudo shutdown -h now", "shutdown")}
                      className="absolute top-1 right-1"
                    >
                      {nvmeCopied === "shutdown" ? "Copied!" : "Copy"}
                    </Button>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded p-3 text-sm text-green-800">
                    <p className="font-medium">After removing SD card:</p>
                    <p>Power on the Pi. It will now boot from the NVMe SSD!</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-purple-200 pt-4">
            <p className="text-sm text-purple-700">
              After completing NVMe setup, reconnect via SSH and continue with the software installation below.
            </p>
          </div>
        </div>
      )}

      {/* Install Command */}
      <div className="border rounded-lg p-6 space-y-4 bg-muted/30">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-lg">One-Line Install</h3>
            <p className="text-sm text-muted-foreground">
              Version {SETUP_CONFIG.version} for Raspberry Pi 5 / Pi 4
            </p>
          </div>
          <span className="text-sm font-medium bg-green-100 text-green-800 px-2 py-1 rounded">
            v{SETUP_CONFIG.version}
          </span>
        </div>

        {/* Command box */}
        <div className="relative">
          <div className="scroll-fade-right">
            <pre className="bg-zinc-900 text-green-400 p-4 rounded-lg text-sm font-mono overflow-x-auto">
              {INSTALL_COMMAND}
            </pre>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCopyCommand}
            className="absolute top-2 right-2"
          >
            {copied ? (
              <>
                <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy
              </>
            )}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Paste this command in your SSH session and press Enter. The script takes about 5-10 minutes to complete.
        </p>
      </div>

      {/* What gets installed */}
      <div className="bg-muted rounded-lg p-4">
        <h4 className="font-medium mb-2">What the script installs:</h4>
        <ul className="text-sm space-y-1 text-muted-foreground">
          <li className="flex items-center gap-2">
            <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Python 3.11 with all dependencies
          </li>
          <li className="flex items-center gap-2">
            <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Volteria Controller software
          </li>
          <li className="flex items-center gap-2">
            <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Systemd service (auto-start on boot)
          </li>
          <li className="flex items-center gap-2">
            <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Configuration template at /etc/volteria/config.yaml
          </li>
        </ul>
      </div>

      {/* View release button */}
      <Button variant="outline" onClick={handleViewRelease} className="w-full">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5 mr-2"
        >
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
        View Release on GitHub
      </Button>

      {/* Alternative: Manual setup */}
      <details className="border rounded-lg">
        <summary className="px-4 py-3 cursor-pointer font-medium hover:bg-muted/50">
          Alternative: Download Script Manually
        </summary>
        <div className="px-4 pb-4 pt-2 text-sm text-muted-foreground space-y-3">
          <p>If you prefer to download and inspect the script first:</p>
          <ol className="list-decimal list-inside space-y-2">
            <li>
              Download the script:
              <div className="scroll-fade-right mt-1">
                <code className="bg-muted px-2 py-1 rounded block overflow-x-auto whitespace-nowrap">
                  wget {SETUP_CONFIG.scriptUrl}
                </code>
              </div>
            </li>
            <li>
              Make it executable:
              <code className="bg-muted px-2 py-1 rounded block mt-1">chmod +x setup-controller.sh</code>
            </li>
            <li>
              Run it:
              <code className="bg-muted px-2 py-1 rounded block mt-1">./setup-controller.sh</code>
            </li>
          </ol>
        </div>
      </details>

      {/* Confirmation checkbox */}
      <label className="flex items-center gap-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/50">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirm(e.target.checked)}
          className="w-5 h-5 rounded border-gray-300"
        />
        <span className="text-sm">
          I have run the setup script and it completed successfully
        </span>
      </label>
    </div>
  );
}
