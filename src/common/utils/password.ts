import bcrypt from "bcryptjs";
import { env } from "@/config/env";

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.bcryptSaltRounds);
}

export function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function hashOtp(code: string): Promise<string> {
  return bcrypt.hash(code, 8);
}

export function compareOtp(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}
