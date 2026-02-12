export const BADGE_XP_BY_RARITY = {
  common: 120,
  rare: 150,
  epic: 200,
  legendary: 450
};

export const MAX_LEVEL = 15;
export const XP_PER_LEVEL = Number(process.env.XP_PER_LEVEL || 700);

export const normalizeRarity = (rarity) => {
  const value = String(rarity || "").toLowerCase();
  if (value in BADGE_XP_BY_RARITY) return value;
  return "common";
};

export const xpForRarity = (rarity) => BADGE_XP_BY_RARITY[normalizeRarity(rarity)];

export const calculateLevelProgress = (totalXp) => {
  const xp = Math.max(0, Number(totalXp) || 0);
  const unclampedLevel = Math.floor(xp / XP_PER_LEVEL) + 1;
  const level = Math.min(MAX_LEVEL, unclampedLevel);
  const minXpForLevel = (level - 1) * XP_PER_LEVEL;
  const currentLevelXp = xp - minXpForLevel;
  const nextLevelXp = level >= MAX_LEVEL ? XP_PER_LEVEL : XP_PER_LEVEL;
  const progressPercent =
    level >= MAX_LEVEL ? 100 : Math.min(100, Math.round((currentLevelXp / XP_PER_LEVEL) * 100));

  return {
    level,
    maxLevel: MAX_LEVEL,
    totalXp: xp,
    currentLevelXp,
    nextLevelXp,
    progressPercent
  };
};
