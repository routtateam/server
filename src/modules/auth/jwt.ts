import jwt from "jsonwebtoken";
import { env } from "@/config/env";
import type { AuthenticatedUser } from "@/common/types/express";

export type JwtPayload = AuthenticatedUser;

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwt.accessSecret, { expiresIn: env.jwt.accessTtl as any });
}

export function signRefreshToken(payload: { id: string; userType: JwtPayload["userType"] }): string {
  return jwt.sign(payload, env.jwt.refreshSecret, { expiresIn: env.jwt.refreshTtl as any });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwt.accessSecret) as JwtPayload;
}

export function verifyRefreshToken(token: string): { id: string; userType: JwtPayload["userType"] } {
  return jwt.verify(token, env.jwt.refreshSecret) as { id: string; userType: JwtPayload["userType"] };
}
