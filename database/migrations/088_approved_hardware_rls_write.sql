-- Add INSERT/UPDATE/DELETE RLS policies for admin users on approved_hardware table
-- Fixes: "new row violates row-level security policy" when creating hardware types
-- Pattern matches 085_controllers_rls_insert_update.sql and 087_controllers_rls_delete.sql

CREATE POLICY "Admin insert access"
ON public.approved_hardware FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
    AND u.role IN ('super_admin', 'backend_admin')
  )
);

CREATE POLICY "Admin update access"
ON public.approved_hardware FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
    AND u.role IN ('super_admin', 'backend_admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
    AND u.role IN ('super_admin', 'backend_admin')
  )
);

CREATE POLICY "Admin delete access"
ON public.approved_hardware FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
    AND u.role IN ('super_admin', 'backend_admin')
  )
);
