-- Add DELETE RLS policy for admin users on controllers table
-- Fixes: delete from admin UI silently fails (PostgREST returns success but 0 rows affected)
-- Pattern matches existing INSERT/UPDATE policies in 085_controllers_rls_insert_update.sql

CREATE POLICY "Admin delete access"
ON public.controllers FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
    AND u.role IN ('super_admin', 'backend_admin')
  )
);
