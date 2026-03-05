const fs = require("fs");
const path = require("path");

function migrateDataDir(dataDir, legacyDataDir) {
  try {
    if (!fs.existsSync(legacyDataDir)) return;
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const legacyFiles = fs.readdirSync(legacyDataDir);
    if (legacyFiles.length === 0) return;
    let migrated = 0;
    for (const file of legacyFiles) {
      const srcPath = path.join(legacyDataDir, file);
      const destPath = path.join(dataDir, file);
      if (fs.existsSync(destPath)) continue;
      const stat = fs.statSync(srcPath);
      if (stat.isFile()) {
        fs.copyFileSync(srcPath, destPath);
        migrated++;
        console.log(`[Migration] Copied ${file} to profile-aware data dir`);
      }
    }
    if (migrated > 0) {
      console.log(`[Migration] Migrated ${migrated} file(s) to ${dataDir}`);
      console.log(`[Migration] Legacy data preserved at ${legacyDataDir}`);
    }
  } catch (e) {
    console.error("[Migration] Failed to migrate data:", e.message);
  }
}

module.exports = { migrateDataDir };
