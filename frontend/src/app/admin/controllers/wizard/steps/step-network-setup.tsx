"use client";

/**
 * Step 4: Network Setup
 *
 * Guide for connecting the controller to the network:
 * - Ethernet (recommended)
 * - WiFi configuration
 */

import { useState } from "react";

interface StepNetworkSetupProps {
  onConfirm: (confirmed: boolean) => void;
  confirmed: boolean;
}

export function StepNetworkSetup({ onConfirm, confirmed }: StepNetworkSetupProps) {
  const [connectionType, setConnectionType] = useState<"ethernet" | "wifi">("ethernet");

  return (
    <div className="space-y-6">
      {/* Introduction */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-800 mb-2">Connect to Network</h3>
        <p className="text-sm text-blue-700">
          The controller needs network access to communicate with the cloud.
          Choose your preferred connection method below.
        </p>
      </div>

      {/* Connection type selector */}
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => setConnectionType("ethernet")}
          className={`p-4 border-2 rounded-lg text-left transition-colors ${
            connectionType === "ethernet"
              ? "border-primary bg-primary/5"
              : "border-muted hover:border-muted-foreground/50"
          }`}
        >
          <div className="flex items-center gap-3 mb-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-6 h-6"
            >
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M7 15h10" />
              <path d="M7 11h10" />
            </svg>
            <span className="font-medium">Ethernet</span>
            <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">Recommended</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Simply plug in an Ethernet cable. No configuration needed.
          </p>
        </button>

        <button
          onClick={() => setConnectionType("wifi")}
          className={`p-4 border-2 rounded-lg text-left transition-colors ${
            connectionType === "wifi"
              ? "border-primary bg-primary/5"
              : "border-muted hover:border-muted-foreground/50"
          }`}
        >
          <div className="flex items-center gap-3 mb-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-6 h-6"
            >
              <path d="M5 12.55a11 11 0 0 1 14.08 0" />
              <path d="M1.42 9a16 16 0 0 1 21.16 0" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
              <line x1="12" y1="20" x2="12.01" y2="20" />
            </svg>
            <span className="font-medium">WiFi</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Requires manual configuration before first boot.
          </p>
        </button>
      </div>

      {/* Instructions based on selection */}
      {connectionType === "ethernet" ? (
        <div className="space-y-4">
          <h4 className="font-medium">Ethernet Setup</h4>

          <div className="space-y-3">
            <div className="flex gap-4 p-4 border rounded-lg">
              <div className="flex-shrink-0 w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-sm">
                1
              </div>
              <div>
                <h5 className="font-medium">Connect Ethernet Cable</h5>
                <p className="text-sm text-muted-foreground">
                  Plug one end of the Ethernet cable into the Raspberry Pi and the other end
                  into your router or network switch.
                </p>
              </div>
            </div>

            <div className="flex gap-4 p-4 border rounded-lg">
              <div className="flex-shrink-0 w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-sm">
                2
              </div>
              <div>
                <h5 className="font-medium">Connect Power</h5>
                <p className="text-sm text-muted-foreground">
                  Connect the USB-C power adapter to your Raspberry Pi 5.
                  Use the official 27W power supply for best results.
                </p>
              </div>
            </div>

            <div className="flex gap-4 p-4 border rounded-lg">
              <div className="flex-shrink-0 w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-sm">
                3
              </div>
              <div>
                <h5 className="font-medium">Wait for Boot</h5>
                <p className="text-sm text-muted-foreground">
                  The Pi will automatically get an IP address via DHCP and attempt
                  to connect to the cloud. This takes about 1-2 minutes.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <h4 className="font-medium">WiFi Setup</h4>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-amber-700">
              WiFi credentials must be configured before powering on the Pi for the first time.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex gap-4 p-4 border rounded-lg">
              <div className="flex-shrink-0 w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-sm">
                1
              </div>
              <div>
                <h5 className="font-medium">Re-insert SD Card</h5>
                <p className="text-sm text-muted-foreground">
                  Put the SD card back into your computer. A drive called &quot;bootfs&quot; should appear.
                </p>
              </div>
            </div>

            <div className="flex gap-4 p-4 border rounded-lg">
              <div className="flex-shrink-0 w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-sm">
                2
              </div>
              <div>
                <h5 className="font-medium">Create WiFi Config File</h5>
                <p className="text-sm text-muted-foreground mb-2">
                  Create a file named <code className="bg-muted px-1 rounded">wpa_supplicant.conf</code> in
                  the bootfs drive with this content:
                </p>
                <div className="scroll-fade-right">
                  <pre className="bg-muted p-3 rounded text-sm sm:text-xs overflow-x-auto max-w-full">
{`country=SA
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

network={
    ssid="YOUR_WIFI_NAME"
    psk="YOUR_WIFI_PASSWORD"
    key_mgmt=WPA-PSK
}`}
                  </pre>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Replace YOUR_WIFI_NAME and YOUR_WIFI_PASSWORD with your actual credentials.
                </p>
              </div>
            </div>

            <div className="flex gap-4 p-4 border rounded-lg">
              <div className="flex-shrink-0 w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-sm">
                3
              </div>
              <div>
                <h5 className="font-medium">Eject and Insert</h5>
                <p className="text-sm text-muted-foreground">
                  Safely eject the SD card, insert it into the Raspberry Pi, and connect power.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LED indicator guide */}
      <div className="bg-muted rounded-lg p-4">
        <h4 className="font-medium mb-2">LED Indicators</h4>
        <div className="text-sm space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-green-500"></span>
            <span><strong>Green LED (ACT):</strong> Flashing = system activity, normal operation</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500"></span>
            <span><strong>Red LED (PWR):</strong> Solid = power connected</span>
          </div>
        </div>
      </div>

      {/* Confirmation checkbox */}
      <label className="flex items-center gap-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/50">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirm(e.target.checked)}
          className="w-5 h-5 rounded border-gray-300"
        />
        <span className="text-sm">
          The Raspberry Pi is powered on and connected to the network
        </span>
      </label>
    </div>
  );
}
