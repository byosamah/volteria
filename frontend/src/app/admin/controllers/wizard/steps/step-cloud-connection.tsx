"use client";

/**
 * Step 5: Cloud Connection
 *
 * Generate and download configuration file for the controller
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface StepCloudConnectionProps {
  controllerId: string | null;
  serialNumber: string;
  onConfirm: (confirmed: boolean) => void;
  confirmed: boolean;
}

export function StepCloudConnection({
  controllerId,
  serialNumber,
  onConfirm,
  confirmed,
}: StepCloudConnectionProps) {
  const [copied, setCopied] = useState(false);

  // Generate config YAML content
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://your-project.supabase.co";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "your-anon-key";

  const configContent = `# Volteria Controller Configuration
# Generated for controller: ${serialNumber}
# Controller ID: ${controllerId}

controller:
  id: "${controllerId}"
  serial_number: "${serialNumber}"

cloud:
  supabase_url: "${supabaseUrl}"
  supabase_key: "${supabaseAnonKey}"
  sync_enabled: true
  heartbeat_interval: 300  # 5 minutes

# Test mode - uses simulated devices for testing
test_mode: true

# Logging
logging:
  level: INFO
  cloud_enabled: true
`;

  const handleCopy = () => {
    navigator.clipboard.writeText(configContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([configContent], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "config.yaml";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Introduction */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-800 mb-2">Configure Cloud Connection</h3>
        <p className="text-sm text-blue-700">
          Download the configuration file and copy it to your controller.
          This file contains the credentials needed to connect to the Volteria cloud.
        </p>
      </div>

      {/* Config display */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium">Configuration File</h4>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleCopy}>
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
            <Button size="sm" onClick={handleDownload}>
              <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download config.yaml
            </Button>
          </div>
        </div>

        <div className="scroll-fade-right">
          <pre className="bg-muted p-4 rounded-lg text-sm sm:text-xs overflow-x-auto font-mono max-w-full">
            {configContent}
          </pre>
        </div>
      </div>

      {/* Instructions */}
      <div className="space-y-4">
        <h4 className="font-medium">How to apply this configuration:</h4>

        {/* Option 1: SSH */}
        <div className="border rounded-lg p-4">
          <h5 className="font-medium flex items-center gap-2 mb-2">
            <span className="w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs font-bold">1</span>
            Option A: Via SSH (if you know the Pi&apos;s IP address)
          </h5>
          <div className="bg-muted p-3 rounded text-sm font-mono">
            <p className="text-muted-foreground mb-1"># Copy the file to the controller</p>
            <code>scp config.yaml pi@&lt;IP_ADDRESS&gt;:/home/pi/solar-controller/</code>
            <p className="text-muted-foreground mt-3 mb-1"># Then restart the service</p>
            <code>ssh pi@&lt;IP_ADDRESS&gt; &quot;sudo systemctl restart volteria-controller&quot;</code>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Default SSH password: <code className="bg-muted px-1 rounded">raspberry</code>
          </p>
        </div>

        {/* Option 2: SD Card */}
        <div className="border rounded-lg p-4">
          <h5 className="font-medium flex items-center gap-2 mb-2">
            <span className="w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs font-bold">2</span>
            Option B: Via SD Card
          </h5>
          <ol className="text-sm space-y-2 text-muted-foreground">
            <li>1. Power off the Raspberry Pi</li>
            <li>2. Remove the SD card and insert it into your computer</li>
            <li>3. Copy <code className="bg-muted px-1 rounded">config.yaml</code> to the bootfs partition</li>
            <li>4. Safely eject, re-insert into Pi, and power on</li>
          </ol>
          <p className="text-xs text-muted-foreground mt-2">
            The controller will automatically move the config file on boot.
          </p>
        </div>
      </div>

      {/* Important notes */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="flex gap-3">
          <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <h4 className="font-medium text-amber-800">Test Mode Enabled</h4>
            <p className="text-sm text-amber-700">
              This configuration has <code className="bg-amber-100 px-1 rounded">test_mode: true</code> enabled,
              which uses simulated devices for testing. After successful testing, you&apos;ll need to
              update the configuration with real device settings.
            </p>
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
          I have copied the configuration file to the controller and restarted the service
        </span>
      </label>
    </div>
  );
}
