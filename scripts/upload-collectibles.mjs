// Run once: node scripts/upload-collectibles.mjs
// Creates a public "collectibles" bucket and uploads all 30 PNGs.
// Prereq: create a public storage bucket called "collectibles" in Supabase dashboard first.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const SUPABASE_URL = "https://xftkfdzqfunmqwwbskll.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmdGtmZHpxZnVubXF3d2Jza2xsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjcyNDUsImV4cCI6MjA5NzIwMzI0NX0.8b9u0NeY6ezvlE-T7vECewn0s8wa6_VSe4hatQe19O4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const IMG_DIR = "/tmp/math_chars/math_collectible_characters_full30";

const files = readdirSync(IMG_DIR)
  .filter((f) => f.endsWith(".png"))
  .sort();

console.log(`Uploading ${files.length} images…\n`);

for (const file of files) {
  const data = readFileSync(join(IMG_DIR, file));
  const { error } = await supabase.storage
    .from("collectibles")
    .upload(file, data, { contentType: "image/png", upsert: true });
  if (error) console.error(`✗ ${file}: ${error.message}`);
  else console.log(`✓ ${file}`);
}

console.log("\nDone.");
