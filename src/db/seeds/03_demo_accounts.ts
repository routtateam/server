import type { Knex } from "knex";
import { hashPassword } from "@/common/utils/password";
import { clearDemoData, seedExtras } from "../seed-data/extras";

// Seeds one demo account per persona, matching the mock data already baked
// into the four frontends so local dev logins "just work" end-to-end:
// - admin: funke@routta.ng / Rtt!Ops2026        (web-ui DEMO_ACCOUNT)
// - commuter: +234 803 411 2094                 (commuter-mobile MOCK_PROFILE)
// - driver: +234 802 555 0148 "Chinedu Okafor"   (transporter-mobile mockData)
// - business: Elite Rides Lagos (premium-business partner)
export async function seed(knex: Knex): Promise<void> {
  await clearDemoData(knex);
  await knex("premium_tiers").del();
  await knex("premium_vehicles").del();
  await knex("business_team_members").del();
  await knex("businesses").del();
  await knex("documents").del();
  await knex("vehicles").del();
  await knex("driver_profiles").del();
  await knex("wallets").del();
  await knex("user_roles").del();
  await knex("users").del();

  const superAdminRole = await knex("roles").where({ name: "Super admin" }).first();

  const [admin] = await knex("users")
    .insert({
      user_type: "admin",
      first_name: "Funke",
      last_name: "Adeyemi",
      email: "funke@routta.ng",
      email_verified: true,
      password_hash: await hashPassword("Rtt!Ops2026"),
      status: "active",
    })
    .returning(["id"]);
  if (superAdminRole) {
    await knex("user_roles").insert({ user_id: admin.id, role_id: superAdminRole.id });
  }

  const [commuter] = await knex("users")
    .insert({
      user_type: "commuter",
      first_name: "Adaeze",
      last_name: "Nwosu",
      email: "ada.nwosu@gmail.com",
      email_verified: true,
      phone: "+2348034112094",
      phone_verified: true,
      rating: 4.8,
      referral_code: "ADAEZE24",
      status: "active",
    })
    .returning(["id"]);
  await knex("wallets").insert({ user_id: commuter.id, balance: 312000 }); // ₦3,120.00

  const [driver] = await knex("users")
    .insert({
      user_type: "driver",
      first_name: "Chinedu",
      last_name: "Okafor",
      email: "chinedu.okafor@example.com",
      phone: "+2348025550148",
      phone_verified: true,
      rating: 4.9,
      status: "active",
    })
    .returning(["id"]);
  await knex("wallets").insert({ user_id: driver.id, balance: 8630000 }); // ₦86,300.00 cleared-ish
  await knex("driver_profiles").insert({
    user_id: driver.id,
    city: "Lagos",
    license_number: "LIC-2024-88213",
    total_trips: 1204,
    total_earned: 41290000,
    member_since_year: 2022,
    verified: true,
    service_fee_pct: 15,
    acceptance_rate: 91,
  });
  const [vehicle] = await knex("vehicles")
    .insert({
      driver_id: driver.id,
      category: "car",
      make: "Toyota",
      model: "Corolla",
      year: 2019,
      colour: "Silver",
      plate: "LSD 419 KJA",
      seats: 4,
      inspection_last_passed: knex.fn.now(),
      inspection_expires: knex.raw("CURRENT_DATE + INTERVAL '9 months'"),
    })
    .returning(["id"]);

  await knex("documents").insert([
    { owner_type: "driver", owner_id: driver.id, doc_key: "licence", doc_name: "Driver's licence", status: "current", meta: "Valid until Jun 2027" },
    { owner_type: "vehicle", owner_id: vehicle.id, doc_key: "inspection", doc_name: "Vehicle inspection", status: "current", meta: "Passed · renews in 9 months" },
    { owner_type: "vehicle", owner_id: vehicle.id, doc_key: "insurance", doc_name: "Insurance", status: "expiring", meta: "Expires in 12 days" },
    { owner_type: "vehicle", owner_id: vehicle.id, doc_key: "registration", doc_name: "Vehicle registration", status: "current", meta: "Valid" },
    { owner_type: "driver", owner_id: driver.id, doc_key: "address", doc_name: "Proof of address", status: "missing", meta: "Upload required" },
  ]);

  const [bizOwner] = await knex("users")
    .insert({
      user_type: "business",
      first_name: "Kayode",
      last_name: "Martins",
      email: "kayode@eliteridelagos.ng",
      email_verified: true,
      password_hash: await hashPassword("Elite!2026"),
      status: "active",
    })
    .returning(["id"]);

  const [business] = await knex("businesses")
    .insert({
      owner_user_id: bizOwner.id,
      name: "Elite Rides Lagos",
      location: "Victoria Island, Lagos",
      about: "Premium chauffeur-driven fleet for executive hire and events.",
      rating: 4.8,
      status: "verified",
      verified_since: knex.raw("CURRENT_DATE - INTERVAL '8 months'"),
    })
    .returning(["id"]);

  await knex("business_team_members").insert({
    business_id: business.id,
    user_id: bizOwner.id,
    invited_email: bizOwner.email,
    role: "owner",
    status: "active",
  });

  const [premiumVehicle] = await knex("premium_vehicles")
    .insert({
      business_id: business.id,
      name: "Toyota Land Cruiser V8",
      type: "SUV",
      brand: "Toyota",
      location: "Victoria Island, Lagos",
      seats: 6,
      from_price: 8500000,
      availability: "available",
      status: "live",
      specs: JSON.stringify([
        { key: "Transmission", value: "Automatic" },
        { key: "Fuel", value: "Petrol" },
        { key: "Chauffeur", value: "Included" },
      ]),
      rating: 4.9,
      reviews: 32,
    })
    .returning(["id"]);

  await knex("premium_tiers").insert([
    { vehicle_id: premiumVehicle.id, label: "4 hours", sub: "Half-day hire", price: 8500000 },
    { vehicle_id: premiumVehicle.id, label: "8 hours", sub: "Full-day hire", price: 15500000 },
    { vehicle_id: premiumVehicle.id, label: "24 hours", sub: "Full day + overnight", price: 26000000 },
  ]);

  await seedExtras(knex, {
    adminId: admin.id,
    commuterId: commuter.id,
    driverId: driver.id,
    vehicleId: vehicle.id,
    bizOwnerId: bizOwner.id,
    businessId: business.id,
    premiumVehicleId: premiumVehicle.id,
  });
}
