"use client";

/**
 * Step 2: Download Image
 *
 * Provide downloadable Raspberry Pi image with:
 * - Image version info
 * - Download button
 * - File size and checksum
 * - Confirmation checkbox
 */

import { Button } from "@/components/ui/button";

interface StepDownloadImageProps {
  onConfirm: (confirmed: boolean) => void;
  confirmed: boolean;
}

// Image download configuration
const IMAGE_CONFIG = {
  version: "1.0.0",
  filename: "volteria-controller-v1.0.0.img.gz",
  size: "~2.5 GB",
  sha256: "Coming soon", // Will be generated when image is built
  downloadUrl: "https://github.com/byosamah/volteria/releases/latest", // Placeholder
};

export function StepDownloadImage({ onConfirm, confirmed }: StepDownloadImageProps) {
  const handleDownload = () => {
    // Open download URL in new tab
    window.open(IMAGE_CONFIG.downloadUrl, "_blank");
  };

  return (
    <div className="space-y-6">
      {/* Introduction */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-800 mb-2">Pre-built Controller Image</h3>
        <p className="text-sm text-blue-700">
          Download our pre-configured Raspberry Pi image that includes everything needed
          to run the Volteria controller software. This is the easiest way to set up a new controller.
        </p>
      </div>

      {/* Image Info Card */}
      <div className="border rounded-lg p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-lg">Volteria Controller Image</h3>
            <p className="text-sm text-muted-foreground">
              Version {IMAGE_CONFIG.version} for Raspberry Pi 5
            </p>
          </div>
          <div className="text-right">
            <span className="text-sm font-medium bg-green-100 text-green-800 px-2 py-1 rounded">
              Latest
            </span>
          </div>
        </div>

        {/* Image details */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">File size:</span>
            <span className="ml-2 font-medium">{IMAGE_CONFIG.size}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Format:</span>
            <span className="ml-2 font-medium">Compressed (.img.gz)</span>
          </div>
        </div>

        {/* What's included */}
        <div className="bg-muted rounded-lg p-4">
          <h4 className="font-medium mb-2">Included in this image:</h4>
          <ul className="text-sm space-y-1 text-muted-foreground">
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Raspberry Pi OS Lite (64-bit)
            </li>
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
              Auto-start service on boot
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              SSH enabled for remote access
            </li>
          </ul>
        </div>

        {/* Download button */}
        <Button onClick={handleDownload} size="lg" className="w-full">
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
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download Image ({IMAGE_CONFIG.size})
        </Button>

        {/* Checksum */}
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">SHA256:</span>{" "}
          <code className="bg-muted px-1 rounded">{IMAGE_CONFIG.sha256}</code>
        </div>
      </div>

      {/* Alternative: Manual setup */}
      <details className="border rounded-lg">
        <summary className="px-4 py-3 cursor-pointer font-medium hover:bg-muted/50">
          Alternative: Manual Setup (Advanced)
        </summary>
        <div className="px-4 pb-4 pt-2 text-sm text-muted-foreground space-y-2">
          <p>If you prefer to set up manually:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Install Raspberry Pi OS Lite (64-bit)</li>
            <li>Install Python 3.11: <code className="bg-muted px-1 rounded">sudo apt install python3.11</code></li>
            <li>Clone the repository: <code className="bg-muted px-1 rounded">git clone https://github.com/byosamah/volteria</code></li>
            <li>Install dependencies: <code className="bg-muted px-1 rounded">pip install -r requirements.txt</code></li>
            <li>Set up systemd service for auto-start</li>
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
          I have downloaded the image file and saved it to my computer
        </span>
      </label>
    </div>
  );
}
