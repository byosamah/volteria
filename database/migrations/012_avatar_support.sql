-- ============================================
-- Migration: 012_avatar_support
-- Adds avatar_url column to users table for profile pictures.
-- ============================================

-- Add avatar_url column to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Comment
COMMENT ON COLUMN users.avatar_url IS 'URL to user profile picture in Supabase Storage';

-- ============================================
-- STORAGE BUCKET SETUP (Run in Supabase Dashboard)
-- ============================================
--
-- 1. Go to Storage in Supabase Dashboard
-- 2. Create bucket named "avatars" with these settings:
--    - Public: Yes (for direct URL access)
--    - File size limit: 2MB
--    - Allowed MIME types: image/jpeg, image/png, image/gif, image/webp
--
-- 3. Add RLS Policy for authenticated uploads:
--
--    -- Allow authenticated users to upload their own avatar
--    CREATE POLICY "Users can upload own avatar" ON storage.objects
--    FOR INSERT TO authenticated
--    WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
--
--    -- Allow authenticated users to update their own avatar
--    CREATE POLICY "Users can update own avatar" ON storage.objects
--    FOR UPDATE TO authenticated
--    USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
--
--    -- Allow authenticated users to delete their own avatar
--    CREATE POLICY "Users can delete own avatar" ON storage.objects
--    FOR DELETE TO authenticated
--    USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
--
--    -- Allow public read access to avatars
--    CREATE POLICY "Public avatar access" ON storage.objects
--    FOR SELECT TO public
--    USING (bucket_id = 'avatars');
-- ============================================
