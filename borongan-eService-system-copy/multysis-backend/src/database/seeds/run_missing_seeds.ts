/**
 * run_missing_seeds.ts
 * Seeds only the missing data: E-Services + transactional Services.
 * Safe to re-run — uses ON CONFLICT / findFirst guards throughout.
 */
import { seedEServices } from './eservices.seed';
import { seedServices }  from './service.seed';

async function main() {
  console.log('🌱 Seeding missing E-Services data...\n');

  await seedServices();
  console.log('');
  await seedEServices();

  console.log('\n🎉 Done!');
}

main().catch(e => {
  console.error('❌ Seed failed:', e);
  process.exit(1);
});
