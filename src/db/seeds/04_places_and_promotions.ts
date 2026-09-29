import type { Knex } from "knex";

// Seeded place catalogue for GET /places/search (the DbGeocodingProvider) + a couple of promo codes.
const PLACES: Array<[string, string, number, number, string?]> = [
  ["Ikeja City Mall", "Obafemi Awolowo Way, Ikeja", 6.6018, 3.3515, "icm mall shopping"],
  ["Murtala Muhammed International Airport", "Ikeja, Lagos", 6.5774, 3.3212, "mmia airport lagos airport"],
  ["Murtala Muhammed Airport Terminal 2", "Ikeja, Lagos", 6.5786, 3.3221, "mmia2 airport domestic"],
  ["Ikoyi Club 1938", "Kingsway Rd, Ikoyi", 6.4531, 3.4363, "ikoyi club"],
  ["Lekki Phase 1 Gate", "Admiralty Way, Lekki", 6.4415, 3.4731, "lekki"],
  ["Balogun Market", "Lagos Island", 6.4531, 3.3958, "market"],
  ["Victoria Island - Adeola Odeku", "Adeola Odeku St, Victoria Island", 6.4281, 3.4219, "vi"],
  ["Eko Hotel & Suites", "Adetokunbo Ademola St, Victoria Island", 6.4287, 3.4227, "eko hotel"],
  ["Landmark Centre", "Water Corporation Rd, Oniru", 6.4238, 3.4448, "landmark beach event centre"],
  ["The Palms Shopping Mall", "Bisway St, Lekki", 6.4494, 3.4711, "palms mall lekki"],
  ["Lekki Conservation Centre", "Lekki-Epe Expressway", 6.4373, 3.5322, "lcc"],
  ["Victoria Island Bar Beach", "Ahmadu Bello Way, Victoria Island", 6.4258, 3.4101, "bar beach"],
  ["National Theatre", "Iganmu, Surulere", 6.4756, 3.3626, "theatre"],
  ["Yaba Tech (Yabatech)", "Herbert Macaulay Way, Yaba", 6.5158, 3.3711, "yabatech polytechnic"],
  ["University of Lagos (UNILAG)", "Akoka, Yaba", 6.5158, 3.3986, "unilag akoka"],
  ["Tafawa Balewa Square", "Lagos Island", 6.4493, 3.4034, "tbs"],
  ["Ojota Bus Stop", "Ikorodu Rd, Ojota", 6.5845, 3.3805, "ojota motor park"],
  ["Ikorodu Garage", "Ikorodu", 6.6194, 3.5105, "ikorodu"],
  ["Maryland Mall", "Ikorodu Rd, Maryland", 6.5677, 3.3653, "maryland"],
  ["Computer Village", "Otigba St, Ikeja", 6.5952, 3.3441, "otigba ikeja computer"],
  ["Allen Avenue Roundabout", "Allen Ave, Ikeja", 6.6014, 3.3509, "allen"],
  ["Ajah Roundabout", "Lekki-Epe Expressway, Ajah", 6.4664, 3.5661, "ajah"],
  ["Festac Town 1st Avenue", "Festac Town", 6.4681, 3.2836, "festac"],
  ["Apapa Port", "Apapa", 6.4474, 3.3593, "apapa wharf"],
  ["Surulere - Adeniran Ogunsanya", "Surulere", 6.5006, 3.3572, "surulere"],
  ["Magodo Phase 2 Gate", "Magodo, Kosofe", 6.6265, 3.3838, "magodo"],
  ["Ikeja GRA", "Ikeja", 6.5833, 3.3517, "gra ikeja"],
  ["Oshodi Transport Interchange", "Oshodi", 6.5551, 3.3459, "oshodi"],
  ["Third Mainland Bridge (Adekunle)", "Adekunle, Yaba", 6.5069, 3.3897, "third mainland"],
  ["Sangotedo Shoprite", "Lekki-Epe Expressway, Sangotedo", 6.4767, 3.6303, "sangotedo"],
];

export async function seed(knex: Knex): Promise<void> {
  await knex("places_catalog").del();
  await knex("places_catalog").insert(PLACES.map(([label, subtitle, lat, lng, aliases]) => ({ label, subtitle, lat, lng, aliases: aliases ?? null, city: "Lagos" })));

  await knex("promotions").del();
  await knex("promotions").insert([
    { code: "WELCOME20", description: "20% off your ride", discount_type: "percent", discount_value: 20, category_scope: "all", status: "active", usage_limit: 1000 },
    { code: "FLAT500", description: "N500 off a car ride", discount_type: "fixed", discount_value: 50000, category_scope: "car", status: "active" },
  ]);
}
