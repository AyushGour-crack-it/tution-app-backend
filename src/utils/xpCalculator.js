export const xpByDifficulty = (difficulty = "") => {
  const key = String(difficulty || "").toLowerCase();
  if (key === "hard") return 40;
  if (key === "medium") return 20;
  return 10;
};

export const subjectLevelFromXp = (xp = 0) => Math.floor(Number(xp || 0) / 150);
export const overallLevelFromXp = (xp = 0) => Math.floor(Number(xp || 0) / 300);
