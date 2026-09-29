import type { Knex } from "knex";

export async function seed(knex: Knex): Promise<void> {
  await knex("pricing_rules").del();
  await knex("pricing_rules").insert([
    { category: "bike", name: "Bike", caption: "1 seat · fastest through traffic", fee_percent: 15, rate_per_km: 18000, sample: "₦1,150 for 6.4km" },
    { category: "car", name: "Car", caption: "4 seats · everyday rides", fee_percent: 18, rate_per_km: 21000, sample: "₦2,450 for 11.7km" },
    { category: "bus", name: "Bus", caption: "16–30 seats · group travel", fee_percent: 20, rate_per_km: 0, sample: "from ₦8,900" },
    { category: "van", name: "Van", caption: "1–5 tons · cargo & moving", fee_percent: 20, rate_per_km: 0, sample: "from ₦14,200" },
  ]);

  await knex("premium_pricing_rules").del();
  await knex("premium_pricing_rules").insert([
    { key: "commission", label: "Routta commission", sub: "Share of gross rental value", value: 20, unit: "%" },
    { key: "service", label: "Service fee", sub: "Charged to the commuter at checkout", value: 5, unit: "%" },
    { key: "deposit", label: "Protection deposit", sub: "Refundable damage/overstay deposit", value: 15, unit: "% of rental" },
    { key: "overstay", label: "Overstay fee", sub: "Per hour past the booked end time", value: 2500, unit: "₦/hr" },
  ]);
}
