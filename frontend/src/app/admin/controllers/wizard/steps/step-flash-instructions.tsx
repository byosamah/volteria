"use client";

/**
 * Step 2: Flash Instructions
 *
 * Visual guide for preparing the controller hardware:
 * - Raspberry Pi: Flash Raspberry Pi OS to SD card using Raspberry Pi Imager
 * - R2000 (eMMC): Power on pre-configured device, connect Ethernet
 */

interface StepFlashInstructionsProps {
  onConfirm: (confirmed: boolean) => void;
  confirmed: boolean;
  hardwareFeatures?: Record<string, unknown> | null;
}

const PI_IMAGER_URL = "https://www.raspberrypi.com/software/";

export function StepFlashInstructions({ onConfirm, confirmed, hardwareFeatures }: StepFlashInstructionsProps) {
  // Check if hardware uses eMMC boot (pre-flashed, no SD card needed)
  const isEmmcBoot = hardwareFeatures?.boot_source === "emmc";

  // R2000 / eMMC-based hardware instructions
  if (isEmmcBoot) {
    return (
      <div className="space-y-6">
        {/* Introduction */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-medium text-blue-800 mb-2">Power On the reComputer Industrial R2000</h3>
          <p className="text-sm text-blue-700">
            This controller comes pre-configured with the operating system on eMMC storage.
            No SD card flashing is needed.
          </p>
        </div>

        {/* Step-by-step instructions */}
        <div className="space-y-4">
          <h4 className="font-medium">Follow these steps:</h4>

          {/* Step 1 */}
          <div className="flex gap-4 p-4 border rounded-lg">
            <div className="flex-shrink-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">
              1
            </div>
            <div>
              <h5 className="font-medium">Connect DC Power</h5>
              <p className="text-sm text-muted-foreground">
                Connect DC power (<span className="font-medium">9-36V</span>) via the terminal block connector.
                Ensure polarity is correct before powering on.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex gap-4 p-4 border rounded-lg">
            <div className="flex-shrink-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">
              2
            </div>
            <div>
              <h5 className="font-medium">Connect Ethernet Cable</h5>
              <p className="text-sm text-muted-foreground">
                Connect an Ethernet cable to the <span className="font-medium">Gigabit port (Port 1)</span>.
                This will be the primary network connection.
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex gap-4 p-4 border rounded-lg">
            <div className="flex-shrink-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">
              3
            </div>
            <div>
              <h5 className="font-medium">Insert nano-SIM (Optional)</h5>
              <p className="text-sm text-muted-foreground">
                If using 4G cellular connectivity, insert a nano-SIM card into the SIM slot.
                This provides fallback internet when Ethernet is unavailable.
              </p>
            </div>
          </div>

          {/* Step 4 */}
          <div className="flex gap-4 p-4 border rounded-lg">
            <div className="flex-shrink-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">
              4
            </div>
            <div>
              <h5 className="font-medium">Power On</h5>
              <p className="text-sm text-muted-foreground">
                Apply power to the terminal block. The controller boots automatically from the
                internal eMMC storage.
              </p>
            </div>
          </div>

          {/* Step 5 */}
          <div className="flex gap-4 p-4 border rounded-lg">
            <div className="flex-shrink-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">
              5
            </div>
            <div>
              <h5 className="font-medium">Wait for Boot</h5>
              <p className="text-sm text-muted-foreground">
                Wait <span className="font-medium">30-60 seconds</span> for the boot process to complete.
                The system LED will stabilize when ready.
              </p>
            </div>
          </div>
        </div>

        {/* Info about hardware features */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <div>
              <h4 className="font-medium text-green-800">Built-in Industrial Features</h4>
              <ul className="text-sm text-green-700 mt-1 space-y-1">
                <li>3x RS485 serial ports + 1x RS232 port</li>
                <li>SuperCAP UPS for safe shutdown on power loss</li>
                <li>Hardware watchdog for auto-recovery</li>
                {hardwareFeatures?.cellular_4g && <li>4G LTE modem for cellular connectivity</li>}
                <li>DC 9-36V wide voltage input range</li>
              </ul>
            </div>
          </div>
        </div>

        {/* What comes next */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            <div>
              <h4 className="font-medium text-blue-800">What&apos;s Next</h4>
              <p className="text-sm text-blue-700">
                In the next step, you&apos;ll SSH into the R2000 and run the setup script.
                The script will verify hardware I/O and install all Volteria controller software.
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
            I have powered on the R2000 and connected Ethernet
          </span>
        </label>
      </div>
    );
  }

  // Default: Raspberry Pi SD card flashing instructions
  return (
    <div className="space-y-6">
      {/* Introduction */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-800 mb-2">Flash Raspberry Pi OS to SD Card</h3>
        <p className="text-sm text-blue-700">
          We use the official Raspberry Pi Imager to flash Raspberry Pi OS Lite.
          The Volteria software will be installed automatically in the next step.
        </p>
      </div>

      {/* Raspberry Pi Imager download */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium">Raspberry Pi Imager</h4>
            <p className="text-sm text-muted-foreground">Official tool for flashing Pi OS</p>
          </div>
          <a
            href={PI_IMAGER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4 mr-2"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Download Imager
          </a>
        </div>
      </div>

      {/* Step-by-step instructions */}
      <div className="space-y-4">
        <h4 className="font-medium">Follow these steps:</h4>

        {/* Step 1 */}
        <div className="flex gap-4 p-4 border rounded-lg">
          <div className="flex-shrink-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">
            1
          </div>
          <div>
            <h5 className="font-medium">Insert SD Card</h5>
            <p className="text-sm text-muted-foreground">
              Insert your microSD card into your computer using an SD card reader.
              Use at least a <span className="font-medium">32GB card</span> (Class 10 or faster recommended).
            </p>
          </div>
        </div>

        {/* Step 2 */}
        <div className="flex gap-4 p-4 border rounded-lg">
          <div className="flex-shrink-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">
            2
          </div>
          <div>
            <h5 className="font-medium">Open Raspberry Pi Imager</h5>
            <p className="text-sm text-muted-foreground">
              Launch Raspberry Pi Imager. If you haven&apos;t installed it yet, download it from the link above.
            </p>
          </div>
        </div>

        {/* Step 3 */}
        <div className="flex gap-4 p-4 border rounded-lg">
          <div className="flex-shrink-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">
            3
          </div>
          <div>
            <h5 className="font-medium">Choose Device</h5>
            <p className="text-sm text-muted-foreground">
              Click <span className="font-medium">&quot;Choose Device&quot;</span> and select your Raspberry Pi model
              (e.g., Pi 5, Pi 4, etc. based on your approved hardware).
            </p>
          </div>
        </div>

        {/* Step 4 */}
        <div className="flex gap-4 p-4 border rounded-lg">
          <div className="flex-shrink-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">
            4
          </div>
          <div>
            <h5 className="font-medium">Choose Operating System</h5>
            <p className="text-sm text-muted-foreground">
              Click <span className="font-medium">&quot;Choose OS&quot;</span> → <code className="bg-muted px-1 rounded">Raspberry Pi OS (other)</code> → <code className="bg-muted px-1 rounded">Raspberry Pi OS Lite (64-bit)</code>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              We use the Lite version (no desktop) for better performance on the controller.
            </p>
          </div>
        </div>

        {/* Step 5 */}
        <div className="flex gap-4 p-4 border rounded-lg">
          <div className="flex-shrink-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">
            5
          </div>
          <div>
            <h5 className="font-medium">Choose Storage</h5>
            <p className="text-sm text-muted-foreground">
              Click <span className="font-medium">&quot;Choose Storage&quot;</span> and select your SD card.
              <span className="text-amber-600 font-medium"> Double-check you select the correct drive!</span>
            </p>
          </div>
        </div>

        {/* Step 6 - Settings (Important!) */}
        <div className="flex gap-4 p-4 border-2 border-blue-200 rounded-lg bg-blue-50/50">
          <div className="flex-shrink-0 w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
            6
          </div>
          <div className="flex-1">
            <h5 className="font-medium text-blue-900">Configure Settings (Important!)</h5>
            <p className="text-sm text-blue-800 mb-3">
              Use the <span className="font-medium">Customisation</span> menu to configure each tab:
            </p>

            {/* Standard credentials box */}
            <div className="bg-white border border-blue-300 rounded-lg p-3 mb-3">
              <h6 className="text-xs font-medium text-blue-900 mb-2 uppercase tracking-wide">Standard Volteria Settings</h6>

              {/* Settings grid */}
              <div className="space-y-3 text-sm">
                {/* Hostname */}
                <div className="flex items-center gap-2">
                  <span className="w-24 text-blue-700 font-medium">Hostname:</span>
                  <code className="bg-blue-100 px-2 py-0.5 rounded font-mono">volteria</code>
                </div>

                {/* Localisation */}
                <div className="border-t border-blue-200 pt-2">
                  <span className="text-xs text-blue-600 uppercase">Localisation</span>
                  <div className="grid grid-cols-2 gap-1 mt-1">
                    <span className="text-blue-700">Capital city:</span>
                    <code className="bg-blue-100 px-1 rounded text-xs">Abu Dhabi (UAE)</code>
                    <span className="text-blue-700">Time zone:</span>
                    <code className="bg-blue-100 px-1 rounded text-xs">Asia/Dubai</code>
                    <span className="text-blue-700">Keyboard:</span>
                    <code className="bg-blue-100 px-1 rounded text-xs">us</code>
                  </div>
                </div>

                {/* User */}
                <div className="border-t border-blue-200 pt-2">
                  <span className="text-xs text-blue-600 uppercase">User</span>
                  <div className="grid grid-cols-2 gap-1 mt-1">
                    <span className="text-blue-700">Username:</span>
                    <code className="bg-blue-100 px-1 rounded text-xs">voltadmin</code>
                    <span className="text-blue-700">Password:</span>
                    <code className="bg-blue-100 px-1 rounded text-xs">Solar@1996</code>
                  </div>
                </div>

                {/* Wi-Fi */}
                <div className="border-t border-blue-200 pt-2">
                  <span className="text-xs text-blue-600 uppercase">Wi-Fi</span>
                  <div className="grid grid-cols-2 gap-1 mt-1">
                    <span className="text-blue-700">SSID:</span>
                    <span className="text-blue-600 text-xs italic">Your WiFi name</span>
                    <span className="text-blue-700">Password:</span>
                    <span className="text-blue-600 text-xs italic">Your WiFi password</span>
                    <span className="text-blue-700">Country:</span>
                    <code className="bg-blue-100 px-1 rounded text-xs">AE</code>
                  </div>
                </div>

                {/* Remote access */}
                <div className="border-t border-blue-200 pt-2">
                  <span className="text-xs text-blue-600 uppercase">Remote Access</span>
                  <div className="grid grid-cols-2 gap-1 mt-1">
                    <span className="text-blue-700">Enable SSH:</span>
                    <code className="bg-green-100 text-green-700 px-1 rounded text-xs">Yes</code>
                    <span className="text-blue-700">Auth method:</span>
                    <code className="bg-blue-100 px-1 rounded text-xs">Password</code>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-xs text-blue-600 font-medium">
              Static IP will be configured automatically by the setup script.
            </p>
          </div>
        </div>

        {/* Step 7 */}
        <div className="flex gap-4 p-4 border rounded-lg">
          <div className="flex-shrink-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">
            7
          </div>
          <div>
            <h5 className="font-medium">Write to SD Card</h5>
            <p className="text-sm text-muted-foreground">
              Click <span className="font-medium">&quot;Write&quot;</span> and confirm. Wait for the process to complete (5-10 minutes).
              The Imager will verify the write automatically.
            </p>
          </div>
        </div>

        {/* Step 8 */}
        <div className="flex gap-4 p-4 border rounded-lg">
          <div className="flex-shrink-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">
            8
          </div>
          <div>
            <h5 className="font-medium">Insert into Raspberry Pi</h5>
            <p className="text-sm text-muted-foreground">
              Once complete, safely eject the SD card from your computer
              and insert it into your Raspberry Pi. Connect Ethernet and power on.
            </p>
          </div>
        </div>
      </div>

      {/* Info about what comes next */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <div className="flex gap-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <div>
            <h4 className="font-medium text-green-800">What&apos;s Next</h4>
            <p className="text-sm text-green-700">
              In the next step, you&apos;ll SSH into your Pi and run our setup script.
              The script will install all Volteria software and configure your controller automatically.
            </p>
          </div>
        </div>
      </div>

      {/* Warning */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="flex gap-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5"
          >
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          <div>
            <h4 className="font-medium text-amber-800">Important</h4>
            <p className="text-sm text-amber-700">
              Flashing will erase all data on the SD card. Make sure you&apos;ve backed up
              any important files before proceeding.
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
          I have flashed Raspberry Pi OS to my SD card and inserted it into the Raspberry Pi
        </span>
      </label>
    </div>
  );
}
