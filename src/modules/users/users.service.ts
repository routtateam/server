import { usersRepository, usersAccountRepository } from "./users.repository";
import { ValidationError } from "@/common/utils/errors";
import { NotFoundError } from "@/common/utils/errors";
import type { CommuterProfileDTO } from "@/modules/auth/auth.types";

function toProfileDto(row: any, ridesCount: number): CommuterProfileDTO {
  return {
    id: row.id,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    email: row.email ?? "",
    emailVerified: row.email_verified,
    phone: row.phone ?? "",
    phoneVerified: row.phone_verified,
    avatarUrl: row.avatar_url ?? undefined,
    rating: Number(row.rating),
    memberSince: String(new Date(row.created_at).getFullYear()),
    ridesCount,
    referralCode: row.referral_code ?? "",
  };
}

function toPlaceDto(row: any) {
  return { id: row.id, label: row.label, subtitle: row.subtitle, lat: Number(row.lat), lng: Number(row.lng), kind: row.kind };
}

function toContactDto(row: any) {
  return { id: row.id, name: row.name, relation: row.relation, phone: row.phone, primary: row.is_primary };
}

export const usersService = {
  async getProfile(userId: string): Promise<CommuterProfileDTO> {
    const row = await usersRepository.findById(userId);
    if (!row) throw new NotFoundError("Profile not found");
    const rides = await usersRepository.countRidesForCommuter(userId);
    return toProfileDto(row, Number(rides?.count ?? 0));
  },

  async updateProfile(userId: string, patch: { firstName?: string; lastName?: string; email?: string; avatarUrl?: string }) {
    const dbPatch: Record<string, unknown> = {};
    if (patch.firstName) dbPatch.first_name = patch.firstName;
    if (patch.lastName) dbPatch.last_name = patch.lastName;
    if (patch.email) {
      dbPatch.email = patch.email.toLowerCase();
      dbPatch.email_verified = false;
    }
    if (patch.avatarUrl) dbPatch.avatar_url = patch.avatarUrl;
    const [row] = await usersRepository.updateProfile(userId, dbPatch);
    const rides = await usersRepository.countRidesForCommuter(userId);
    return toProfileDto(row, Number(rides?.count ?? 0));
  },

  async listPlaces(userId: string) {
    const rows = await usersRepository.listPlaces(userId);
    return rows.map(toPlaceDto);
  },

  async createPlace(userId: string, input: { label: string; subtitle?: string; lat: number; lng: number; kind: string }) {
    const [row] = await usersRepository.createPlace(userId, input);
    return toPlaceDto(row);
  },

  /**
   * Delete-account: refuses while a ride is active or the wallet still holds money (so funds are never silently
   * destroyed), otherwise soft-deletes and anonymises. Existing access tokens expire on their own (15m); refresh
   * and login stop working immediately because deleted users are excluded from every lookup.
   */
  async deleteAccount(userId: string) {
    const [active, wallet] = await Promise.all([usersAccountRepository.activeTripCount(userId), usersAccountRepository.walletBalance(userId)]);
    if (Number(active?.count ?? 0) > 0) throw new ValidationError("Finish or cancel your active ride before deleting your account.");
    if (Number(wallet?.balance ?? 0) > 0) throw new ValidationError("Withdraw or spend your wallet balance first, or contact support to have it refunded.");
    await usersAccountRepository.softDeleteAndAnonymise(userId);
    return { deleted: true };
  },

  async deletePlace(userId: string, placeId: string) {
    await usersRepository.deletePlace(userId, placeId);
  },

  async listEmergencyContacts(userId: string) {
    const rows = await usersRepository.listEmergencyContacts(userId);
    return rows.map(toContactDto);
  },

  async createEmergencyContact(userId: string, input: { name: string; relation?: string; phone: string; primary?: boolean }) {
    const [row] = await usersRepository.createEmergencyContact(userId, {
      name: input.name,
      relation: input.relation,
      phone: input.phone,
      is_primary: input.primary ?? false,
    });
    return toContactDto(row);
  },

  async deleteEmergencyContact(userId: string, contactId: string) {
    await usersRepository.deleteEmergencyContact(userId, contactId);
  },
};
