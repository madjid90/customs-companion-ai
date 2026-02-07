
-- Phone users table (invitation whitelist)
CREATE TABLE public.phone_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  display_name TEXT,
  role app_role NOT NULL DEFAULT 'agent',
  is_active BOOLEAN DEFAULT true,
  auth_user_id UUID UNIQUE,
  invited_by UUID REFERENCES public.phone_users(id) ON DELETE SET NULL,
  max_invites INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- OTP codes table
CREATE TABLE public.otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  is_used BOOLEAN DEFAULT false,
  attempts INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.phone_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;

-- Security definer function to check if a user is a phone manager
CREATE OR REPLACE FUNCTION public.is_phone_manager(_auth_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.phone_users
    WHERE auth_user_id = _auth_user_id
      AND role = 'manager'
      AND is_active = true
  )
$$;

-- Security definer function to get phone_user_id from auth_user_id
CREATE OR REPLACE FUNCTION public.get_phone_user_id(_auth_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.phone_users
  WHERE auth_user_id = _auth_user_id
  LIMIT 1
$$;

-- RLS: Managers can view all phone users, agents can view themselves
CREATE POLICY "Managers can view all phone users"
ON public.phone_users FOR SELECT
TO authenticated
USING (public.is_phone_manager(auth.uid()));

CREATE POLICY "Users can view own record"
ON public.phone_users FOR SELECT
TO authenticated
USING (auth_user_id = auth.uid());

-- Managers can insert phone users (invite)
CREATE POLICY "Managers can insert phone users"
ON public.phone_users FOR INSERT
TO authenticated
WITH CHECK (public.is_phone_manager(auth.uid()));

-- Managers can update phone users
CREATE POLICY "Managers can update phone users"
ON public.phone_users FOR UPDATE
TO authenticated
USING (public.is_phone_manager(auth.uid()));

-- Managers can delete phone users (revoke access)
CREATE POLICY "Managers can delete phone users"
ON public.phone_users FOR DELETE
TO authenticated
USING (public.is_phone_manager(auth.uid()));

-- OTP codes: only service role
CREATE POLICY "Service role only for otp_codes"
ON public.otp_codes FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- has_role function
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Trigger for updated_at on phone_users
CREATE OR REPLACE FUNCTION public.update_phone_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_phone_users_updated_at
BEFORE UPDATE ON public.phone_users
FOR EACH ROW
EXECUTE FUNCTION public.update_phone_users_updated_at();

-- RLS policy for conversations: let managers see all conversations
CREATE POLICY "Managers can view all conversations"
ON public.conversations FOR SELECT
TO authenticated
USING (public.is_phone_manager(auth.uid()));
