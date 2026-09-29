import { driversRepository, driversExtraRepository } from "./drivers.repository";
import { startOfLocalDay, startOfLocalWeek, startOfLocalMonth, addDays, localHour, formatDuration } from "@/common/utils/time";
import { getStorage, sniffFileType } from "@/integrations/storage";
import { randomUUID } from "node:crypto";
import { env } from "@/config/env";
import { NotFoundError, ValidationError } from "@/common/utils/errors";
import { verificationProvider } from "@/integrations/verification";
import { eventBus, DomainEvents } from "@/events/eventBus";
import { dispatchPayout } from "@/jobs/dispatch";

function initials(first?: string | null, last?: string | null) {
  return `${(first ?? "?")[0] ?? ""}${(last ?? "?")[0] ?? ""}`.toUpperCase();
}

function toDriverDto(user: any, profile: any) {
  return {
    id: user.id,
    firstName: user.first_name ?? "",
    lastName: user.last_name ?? "",
    phone: user.phone ?? "",
    email: user.email ?? "",
    city: profile?.city ?? "",
    initials: initials(user.first_name, user.last_name),
    rating: Number(user.rating),
    totalTrips: profile?.total_trips ?? 0,
    totalEarned: profile?.total_earned ?? 0,
    memberSince: profile?.member_since_year ?? new Date(user.created_at).getFullYear(),
    verified: profile?.verified ?? false,
    online: profile?.online ?? false,
    acceptanceRate: Number(profile?.acceptance_rate ?? 100),
  };
}

function toVehicleDto(row: any) {
  if (!row) return null;
  return {
    category: row.category,
    make: row.make,
    model: row.model,
    year: row.year,
    colour: row.colour,
    plate: row.plate,
    seats: row.seats,
    serviceFeePct: 15,
    inspectionLastPassed: row.inspection_last_passed,
    inspectionExpires: row.inspection_expires,
  };
}

function toDocumentDto(row: any) {
  return { key: row.doc_key, name: row.doc_name, hint: row.meta ?? "", status: row.status, meta: row.meta ?? "" };
}

type Period = "today" | "yesterday" | "week" | "month";

const DEFAULT_SETTINGS = {
  autoAcceptNearby: false,
  longTripsOnly: false,
  voiceNavigation: true,
  readRequestsAloud: true,
  shareTripsWithFamily: true,
  navigationApp: "Google Maps",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function periodRange(period: Period): { from: Date; to: Date } {
  const now = new Date();
  const today = startOfLocalDay(now);
  if (period === "today") return { from: today, to: addDays(today, 1) };
  if (period === "yesterday") return { from: addDays(today, -1), to: today };
  if (period === "week") {
    const from = startOfLocalWeek(now);
    return { from, to: addDays(from, 7) };
  }
  const from = startOfLocalMonth(now);
  const nextMonth = addDays(from, 32);
  return { from, to: addDays(startOfLocalMonth(nextMonth), 0) };
}

/** Buckets earnings for a period: hourly (today/yesterday), per weekday (week), per 7-day block (month). */
function buildSeries(period: Period, from: Date, rows: Array<{ amount: any; created_at: Date }>) {
  let buckets: Array<{ key: string; label: string; amount: number; trips: number }>;
  let indexOf: (d: Date) => number;
  if (period === "today" || period === "yesterday") {
    buckets = Array.from({ length: 24 }, (_, h) => ({ key: String(h), label: `${String(h).padStart(2, "0")}:00`, amount: 0, trips: 0 }));
    indexOf = (d) => localHour(d);
  } else if (period === "week") {
    buckets = WEEKDAYS.map((label, i) => ({ key: String(i), label, amount: 0, trips: 0 }));
    indexOf = (d) => Math.min(6, Math.floor((d.getTime() - from.getTime()) / 86_400_000));
  } else {
    const { to } = periodRange("month");
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    const n = Math.ceil(days / 7);
    buckets = Array.from({ length: n }, (_, i) => ({ key: String(i), label: `Wk ${i + 1}`, amount: 0, trips: 0 }));
    indexOf = (d) => Math.min(n - 1, Math.floor((d.getTime() - from.getTime()) / (7 * 86_400_000)));
  }
  for (const r of rows) {
    const i = indexOf(new Date(r.created_at));
    if (buckets[i]) {
      buckets[i].amount += Number(r.amount);
      buckets[i].trips += 1;
    }
  }
  return buckets;
}

function maskAccount(n?: string | null) {
  return n ? `•••${n.slice(-4)}` : "";
}

function toBankDto(row: any) {
  if (!row?.payout_account_number) return null;
  return {
    bankName: row.payout_bank_name,
    bankCode: row.payout_bank_code ?? null,
    accountName: row.payout_account_name,
    accountNumberMasked: maskAccount(row.payout_account_number),
    accountNumberLast4: row.payout_account_number.slice(-4),
  };
}

export const driversService = {
  async getMe(userId: string) {
    const [user, profile] = await Promise.all([driversRepository.findUser(userId), driversRepository.findProfile(userId)]);
    if (!user) throw new NotFoundError("Driver not found");
    return toDriverDto(user, profile);
  },

  async updateMe(userId: string, patch: { city?: string; firstName?: string; lastName?: string }) {
    if (patch.firstName || patch.lastName) {
      await driversRepository.updateUser(userId, {
        ...(patch.firstName ? { first_name: patch.firstName } : {}),
        ...(patch.lastName ? { last_name: patch.lastName } : {}),
      });
    }
    if (patch.city) await driversRepository.updateProfile(userId, { city: patch.city });
    return this.getMe(userId);
  },

  async setOnline(userId: string, online: boolean) {
    await driversRepository.updateProfile(userId, { online });
    // Online-hours tracking: one open session while online.
    if (online) await driversExtraRepository.openSession(userId);
    else await driversExtraRepository.closeSession(userId);
    return { online };
  },

  /** Presence only — overwrites the driver's last-known fix. Not a location-history trail. */
  async reportLocation(userId: string, lat: number, lng: number) {
    await driversRepository.updateProfile(userId, { last_lat: lat, last_lng: lng, last_location_at: new Date() });
    return { ok: true };
  },

  async getVehicle(userId: string) {
    const row = await driversRepository.findVehicle(userId);
    return toVehicleDto(row);
  },

  async upsertVehicle(userId: string, input: any) {
    const row = await driversRepository.upsertVehicle(userId, input);
    return toVehicleDto(row);
  },

  async listDocuments(userId: string) {
    const vehicle = await driversRepository.findVehicle(userId);
    const driverDocs = await driversRepository.listDocuments("driver", userId);
    const vehicleDocs = vehicle ? await driversRepository.listDocuments("vehicle", vehicle.id) : [];
    return [...driverDocs, ...vehicleDocs].map(toDocumentDto);
  },

  async uploadRenewal(userId: string, docKey: string, fileUrl?: string) {
    const vehicle = await driversRepository.findVehicle(userId);
    const isVehicleDoc = ["inspection", "insurance", "registration"].includes(docKey);
    const ownerType = isVehicleDoc ? "vehicle" : "driver";
    const ownerId = isVehicleDoc ? vehicle?.id : userId;
    if (!ownerId) throw new ValidationError("Add a vehicle before uploading vehicle documents.");

    // Routes through the (unwired) verification provider stub — currently
    // always comes back pending_manual_review; see src/integrations/verification/README.md.
    const check = await verificationProvider.verifyDriverLicense({
      licenseNumber: "N/A",
      firstName: "",
      lastName: "",
    });

    const row = await driversRepository.upsertDocumentStatus(ownerType, ownerId, docKey, {
      doc_name: docKey,
      file_url: fileUrl,
      status: "pending",
      meta: "Under review · usually within 24 hours",
    });
    eventBus.publish(DomainEvents.DriverVerificationSubmitted, { userId, docKey, providerVerdict: check.verdict });
    return toDocumentDto(row);
  },

  async earningsPeriod(userId: string, period: Period) {
    const { from, to } = periodRange(period);
    const [rows, stats, onlineSecs] = await Promise.all([
      driversExtraRepository.earningsBetween(userId, from, to),
      driversExtraRepository.completedTripStats(userId, from, to),
      driversExtraRepository.onlineSeconds(userId, from, to),
    ]);
    const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);
    const trips = stats.trips;
    const labels: Record<Period, string> = {
      today: "EARNED TODAY",
      yesterday: "EARNED YESTERDAY",
      week: "EARNED THIS WEEK",
      month: "EARNED THIS MONTH",
    };
    return {
      label: labels[period],
      total,
      sub: `${trips} trip${trips === 1 ? "" : "s"}`,
      trips,
      avgPerTrip: trips ? Math.round(total / trips) : 0,
      onlineSeconds: onlineSecs,
      onlineHours: formatDuration(onlineSecs),
      distanceKm: Math.round(stats.km * 10) / 10,
      /** Per-bucket series: hourly (today/yesterday), Mon-Sun (week), 7-day blocks (month). Amounts in kobo. */
      series: buildSeries(period, from, rows),
    };
  },

  /** One-call dashboard aggregate: today, yesterday, week, online time and acceptance rate. */
  async dashboard(userId: string) {
    const [profile, today, yesterday, week] = await Promise.all([
      driversRepository.findProfile(userId),
      this.earningsPeriod(userId, "today"),
      this.earningsPeriod(userId, "yesterday"),
      this.earningsPeriod(userId, "week"),
    ]);
    return {
      earnedToday: today.total,
      tripsToday: today.trips,
      onlineSeconds: today.onlineSeconds,
      onlineDuration: today.onlineHours,
      distanceKm: today.distanceKm,
      acceptanceRate: Math.round(Number(profile?.acceptance_rate ?? 100)),
      yesterdayEarned: yesterday.total,
      yesterdayTrips: yesterday.trips,
      weekEarned: week.total,
    };
  },

  async ledger(userId: string) {
    const rows = await driversRepository.ledger(userId);
    return rows.map((r) => ({ id: r.id, kind: r.type, title: r.type, meta: r.provider ?? "", amount: Number(r.amount) }));
  },

  async availableBalance(userId: string) {
    const [wallet, bank] = await Promise.all([driversRepository.getWallet(userId), driversExtraRepository.getBank(userId)]);
    return { cleared: Number(wallet?.balance ?? 0), pending: 0, bank: toBankDto(bank) };
  },

  async getPayoutAccount(userId: string) {
    return toBankDto(await driversExtraRepository.getBank(userId));
  },

  /**
   * Stores the payout bank account. TODO(monnify): resolve the account name through Monnify "validate bank account"
   * (name enquiry) and compare it with accountName before accepting; today the driver-entered name is trusted.
   */
  async setPayoutAccount(userId: string, input: { bankName: string; bankCode?: string; accountNumber: string; accountName: string }) {
    await driversExtraRepository.setBank(userId, { name: input.bankName, code: input.bankCode, number: input.accountNumber, accountName: input.accountName });
    return toBankDto(await driversExtraRepository.getBank(userId));
  },

  async quotePayout(userId: string, amount: number) {
    const fee = 5000; // N50 flat fee, minor units
    const bank = toBankDto(await driversExtraRepository.getBank(userId));
    return { amount, fee, net: amount - fee, bank };
  },

  async confirmPayout(userId: string, amount: number) {
    const bankRow = await driversExtraRepository.getBank(userId);
    if (!bankRow?.payout_account_number) throw new ValidationError("Add a payout bank account before cashing out.");
    const wallet = await driversRepository.getWallet(userId);
    if (!wallet || Number(wallet.balance) < amount) throw new ValidationError("Insufficient available balance for this payout.");
    const fee = 5000;
    const net = amount - fee;
    if (net <= 0) throw new ValidationError("Amount is too small to cover the payout fee.");
    const payout = await driversRepository.createPayout(userId, amount, fee, net, {
      bankName: bankRow.payout_bank_name,
      bankCode: bankRow.payout_bank_code,
      accountNumber: bankRow.payout_account_number,
      accountName: bankRow.payout_account_name,
    });
    await driversRepository.debitWalletForPayout(userId, amount);
    await dispatchPayout(payout.id);
    eventBus.publish(DomainEvents.PayoutRequested, { payoutId: payout.id, driverId: userId });
    return { ok: true as const, reference: payout.reference };
  },

  // ---- Settings ----

  async getSettings(userId: string) {
    const [row, contacts] = await Promise.all([driversExtraRepository.getSettings(userId), driversExtraRepository.countEmergencyContacts(userId)]);
    return { ...DEFAULT_SETTINGS, ...(row?.settings ?? {}), emergencyContactsCount: Number(contacts?.count ?? 0) };
  },

  async updateSettings(userId: string, patch: Record<string, unknown>) {
    const row = await driversExtraRepository.getSettings(userId);
    await driversExtraRepository.setSettings(userId, { ...DEFAULT_SETTINGS, ...(row?.settings ?? {}), ...patch });
    return this.getSettings(userId);
  },

  // ---- Document upload (multipart; local-disk storage behind StorageProvider) ----

  async uploadDocumentFile(userId: string, docKey: string, file?: { buffer: Buffer; size: number }) {
    if (!file?.buffer?.length) throw new ValidationError('Attach a file in the "file" field.');
    if (file.size > env.storage.maxUploadBytes) throw new ValidationError("File is too large.");
    const sniffed = sniffFileType(file.buffer);
    if (!sniffed) throw new ValidationError("Unsupported file type. Upload a JPG, PNG, WebP or PDF.");

    const vehicle = await driversRepository.findVehicle(userId);
    const isVehicleDoc = ["inspection", "insurance", "registration"].includes(docKey);
    const ownerType = isVehicleDoc ? "vehicle" : "driver";
    const ownerId = isVehicleDoc ? vehicle?.id : userId;
    if (!ownerId) throw new ValidationError("Add a vehicle before uploading vehicle documents.");

    const key = `documents/${ownerId}/${randomUUID()}${sniffed.ext}`;
    await getStorage().put({ key, body: file.buffer, contentType: sniffed.type });

    // Status stays "pending" until an admin reviews it; the verification provider is still the research-only stub.
    const row = await driversRepository.upsertDocumentStatus(ownerType, ownerId, docKey, {
      doc_name: docKey,
      file_url: `${env.apiPrefix}/files/${key}`,
      status: "pending",
      meta: "Under review · usually within 24 hours",
    });
    eventBus.publish(DomainEvents.DriverVerificationSubmitted, { userId, docKey, providerVerdict: "pending_manual_review" });
    return toDocumentDto(row);
  },

  async reviews(userId: string) {
    const rows = await driversRepository.listReviews(userId);
    return rows.map((r) => ({ id: r.id, stars: Number(r.rating_by_commuter), date: r.completed_at }));
  },
};
