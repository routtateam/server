import type { Permission } from "@/modules/rbac/permissions";
import type { UserType } from "@/common/types/express";

export interface UserRow {
  id: string;
  user_type: UserType;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  email_verified: boolean;
  phone: string | null;
  phone_verified: boolean;
  password_hash: string | null;
  avatar_url: string | null;
  rating: string;
  status: string;
  referral_code: string | null;
  created_at: Date;
}

export interface CommuterProfileDTO {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean;
  phone: string;
  phoneVerified: boolean;
  avatarUrl?: string;
  rating: number;
  memberSince: string;
  ridesCount: number;
  referralCode: string;
}

export interface AuthSessionDTO {
  token: string;
  refreshToken: string;
  profile: CommuterProfileDTO;
}

export interface DriverDTO {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  city: string;
  initials: string;
  rating: number;
  totalTrips: number;
  totalEarned: number;
  memberSince: number;
  verified: boolean;
}

export interface StaffSessionDTO {
  id: string;
  name: string;
  email: string;
  initials: string;
  role: string;
  title: string;
  permissions: Permission[];
}
