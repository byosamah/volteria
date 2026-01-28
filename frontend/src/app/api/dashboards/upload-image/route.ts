/**
 * Dashboard Image Upload API
 *
 * Uploads images to Supabase Storage for dashboard widgets.
 * Validates file size, dimensions, and format.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_FILE_SIZE = 512000; // 500KB
const MAX_DIMENSION = 1024; // 1024x1024 max
const ALLOWED_TYPES = ["image/png", "image/svg+xml", "image/jpeg"];

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Invalid file type. Allowed: PNG, SVG, JPEG` },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size: 500KB` },
        { status: 400 }
      );
    }

    // For PNG/JPEG, validate dimensions
    if (file.type === "image/png" || file.type === "image/jpeg") {
      const arrayBuffer = await file.arrayBuffer();
      const dimensions = await getImageDimensions(arrayBuffer, file.type);

      if (dimensions && (dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION)) {
        return NextResponse.json(
          { error: `Image too large. Maximum dimensions: ${MAX_DIMENSION}x${MAX_DIMENSION}px` },
          { status: 400 }
        );
      }
    }

    // Generate unique filename
    const ext = file.type === "image/svg+xml" ? "svg" : file.type === "image/png" ? "png" : "jpg";
    const filename = `${user.id}/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from("dashboard-images")
      .upload(filename, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.error("Storage upload error:", error);
      return NextResponse.json(
        { error: "Failed to upload image" },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("dashboard-images")
      .getPublicUrl(data.path);

    return NextResponse.json({
      url: urlData.publicUrl,
      path: data.path,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Get image dimensions from buffer (PNG/JPEG only)
 */
async function getImageDimensions(
  buffer: ArrayBuffer,
  mimeType: string
): Promise<{ width: number; height: number } | null> {
  const view = new DataView(buffer);

  try {
    if (mimeType === "image/png") {
      // PNG: width at offset 16, height at offset 20 (big-endian)
      if (view.byteLength >= 24) {
        const width = view.getUint32(16, false);
        const height = view.getUint32(20, false);
        return { width, height };
      }
    } else if (mimeType === "image/jpeg") {
      // JPEG: Find SOF0/SOF2 marker
      let offset = 2;
      while (offset < view.byteLength - 9) {
        const marker = view.getUint16(offset, false);
        if (marker === 0xffc0 || marker === 0xffc2) {
          // SOF0 or SOF2
          const height = view.getUint16(offset + 5, false);
          const width = view.getUint16(offset + 7, false);
          return { width, height };
        }
        // Skip to next marker
        const length = view.getUint16(offset + 2, false);
        offset += 2 + length;
      }
    }
  } catch {
    // Failed to parse, return null
  }

  return null;
}

/**
 * DELETE: Remove an uploaded image
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const path = searchParams.get("path");

    if (!path) {
      return NextResponse.json({ error: "No path provided" }, { status: 400 });
    }

    // Only allow deleting own images
    if (!path.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await supabase.storage
      .from("dashboard-images")
      .remove([path]);

    if (error) {
      console.error("Storage delete error:", error);
      return NextResponse.json(
        { error: "Failed to delete image" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
