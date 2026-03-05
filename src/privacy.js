const fs = require("fs");
const path = require("path");

function getPrivacyFilePath(dataDir) {
  return path.join(dataDir, "privacy-settings.json");
}

function loadPrivacySettings(dataDir) {
  try {
    const privacyFile = getPrivacyFilePath(dataDir);
    if (fs.existsSync(privacyFile)) {
      return JSON.parse(fs.readFileSync(privacyFile, "utf8"));
    }
  } catch (e) {
    console.error("Failed to load privacy settings:", e.message);
  }
  return {
    version: 1,
    hiddenTopics: [],
    hiddenSessions: [],
    hiddenCrons: [],
    hideHostname: false,
    updatedAt: null,
  };
}

function savePrivacySettings(dataDir, data) {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(getPrivacyFilePath(dataDir), JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error("Failed to save privacy settings:", e.message);
    return false;
  }
}

module.exports = {
  loadPrivacySettings,
  savePrivacySettings,
};
