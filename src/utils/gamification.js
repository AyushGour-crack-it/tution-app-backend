export const BADGE_XP_BY_RARITY = {
  common: 120,
  rare: 150,
  epic: 200,
  legendary: 450,
  mythic: 1000
};

export const MAX_LEVEL = 15;
export const LEVEL_XP_THRESHOLDS = [
  0, // Level 1
  80, // Level 2
  180, // Level 3
  320, // Level 4
  500, // Level 5
  800, // Level 6
  1200, // Level 7
  1700, // Level 8
  2300, // Level 9
  3000, // Level 10
  4300, // Level 11
  5900, // Level 12
  7600, // Level 13
  9400, // Level 14
  11300 // Level 15
];

export const normalizeRarity = (rarity) => {
  const value = String(rarity || "").toLowerCase();
  if (value in BADGE_XP_BY_RARITY) return value;
  return "common";
};

export const xpForRarity = (rarity) => BADGE_XP_BY_RARITY[normalizeRarity(rarity)];

export const calculateLevelProgress = (totalXp) => {
  const xp = Math.max(0, Number(totalXp) || 0);
  let level = 1;
  for (let idx = 0; idx < LEVEL_XP_THRESHOLDS.length; idx += 1) {
    if (xp >= LEVEL_XP_THRESHOLDS[idx]) {
      level = idx + 1;
    } else {
      break;
    }
  }
  level = Math.min(MAX_LEVEL, level);

  const currentThreshold = LEVEL_XP_THRESHOLDS[level - 1] || 0;
  const nextThreshold = LEVEL_XP_THRESHOLDS[level] || currentThreshold;
  const currentLevelXp = xp - currentThreshold;
  const nextLevelXp = Math.max(1, nextThreshold - currentThreshold);
  const progressPercent =
    level >= MAX_LEVEL ? 100 : Math.min(100, Math.round((currentLevelXp / nextLevelXp) * 100));

  return {
    level,
    maxLevel: MAX_LEVEL,
    totalXp: xp,
    currentLevelXp,
    nextLevelXp,
    progressPercent
  };
};
