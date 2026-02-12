import mongoose from "mongoose";
import { BADGE_XP_BY_RARITY, xpForRarity } from "../utils/gamification.js";

const BadgeDefinitionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    category: {
      type: String,
      enum: ["academic", "consistency", "personality", "inspired", "secret", "fun_event"],
      required: true
    },
    rarity: {
      type: String,
      enum: Object.keys(BADGE_XP_BY_RARITY),
      required: true
    },
    xpValue: { type: Number, required: true },
    annualCap: { type: Number, default: null },
    imageUrl: { type: String, default: "" },
    hidden: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 }
  },
  { timestamps: true }
);

BadgeDefinitionSchema.pre("validate", function syncXpValue(next) {
  if (!this.xpValue) {
    this.xpValue = xpForRarity(this.rarity);
  }
  next();
});

export default mongoose.model("BadgeDefinition", BadgeDefinitionSchema);
