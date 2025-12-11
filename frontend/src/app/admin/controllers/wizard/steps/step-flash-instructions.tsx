"use client";

/**
 * Step 3: Flash Instructions
 *
 * Visual guide for flashing the image using Balena Etcher
 */

interface StepFlashInstructionsProps {
  onConfirm: (confirmed: boolean) => void;
  confirmed: boolean;
}

const BALENA_ETCHER_URL = "https://etcher.balena.io/";

export function StepFlashInstructions({ onConfirm, confirmed }: StepFlashInstructionsProps) {
  return (
    <div className="space-y-6">
      {/* Introduction */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-800 mb-2">Flash the Image to SD Card</h3>
        <p className="text-sm text-blue-700">
          We recommend using Balena Etcher - a free, easy-to-use tool that works on Windows, Mac, and Linux.
        </p>
      </div>

      {/* Balena Etcher download */}
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium">Balena Etcher</h4>
            <p className="text-sm text-muted-foreground">Free SD card flashing tool</p>
          </div>
          <a
            href={BALENA_ETCHER_URL}
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
            Download Etcher
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
              Make sure the card is at least 32GB.
            </p>
          </div>
        </div>

        {/* Step 2 */}
        <div className="flex gap-4 p-4 border rounded-lg">
          <div className="flex-shrink-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">
            2
          </div>
          <div>
            <h5 className="font-medium">Open Balena Etcher</h5>
            <p className="text-sm text-muted-foreground">
              Launch Balena Etcher. If you haven&apos;t installed it yet, download it from the link above.
            </p>
          </div>
        </div>

        {/* Step 3 */}
        <div className="flex gap-4 p-4 border rounded-lg">
          <div className="flex-shrink-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">
            3
          </div>
          <div>
            <h5 className="font-medium">Select the Image</h5>
            <p className="text-sm text-muted-foreground">
              Click &quot;Flash from file&quot; and select the <code className="bg-muted px-1 rounded">volteria-controller-v1.0.0.img.gz</code> file
              you downloaded in the previous step. Etcher can flash compressed files directly.
            </p>
          </div>
        </div>

        {/* Step 4 */}
        <div className="flex gap-4 p-4 border rounded-lg">
          <div className="flex-shrink-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">
            4
          </div>
          <div>
            <h5 className="font-medium">Select Target Drive</h5>
            <p className="text-sm text-muted-foreground">
              Click &quot;Select target&quot; and choose your SD card.
              <span className="text-amber-600 font-medium"> Be careful to select the correct drive!</span>
            </p>
          </div>
        </div>

        {/* Step 5 */}
        <div className="flex gap-4 p-4 border rounded-lg">
          <div className="flex-shrink-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">
            5
          </div>
          <div>
            <h5 className="font-medium">Flash!</h5>
            <p className="text-sm text-muted-foreground">
              Click &quot;Flash!&quot; and wait for the process to complete. This usually takes 5-10 minutes.
              Etcher will verify the flash automatically.
            </p>
          </div>
        </div>

        {/* Step 6 */}
        <div className="flex gap-4 p-4 border rounded-lg">
          <div className="flex-shrink-0 w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold">
            6
          </div>
          <div>
            <h5 className="font-medium">Insert into Raspberry Pi</h5>
            <p className="text-sm text-muted-foreground">
              Once flashing is complete, safely eject the SD card from your computer
              and insert it into your Raspberry Pi 5.
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
          I have flashed the image to my SD card and inserted it into the Raspberry Pi
        </span>
      </label>
    </div>
  );
}
