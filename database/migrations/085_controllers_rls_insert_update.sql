-- Add INSERT and UPDATE RLS policies for admin users on controllers table
-- Allows super_admin and backend_admin to create/update controllers via wizard
-- Pattern matches control_commands and other tables in this codebase

-- INSERT policy: admin users can create controllers
CREATE POLICY "Admin insert access"
ON public.controllers FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
    AND u.role IN ('super_admin', 'backend_admin')
  )
);

-- UPDATE policy: admin users can update controllers (wizard step, status, test_results)
CREATE POLICY "Admin update access"
ON public.controllers FOR UPDATE
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
