import mongoose from "mongoose";

const StudentBadgeSchema = new mongoose.Schema(
  {
    studentUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    badgeKey: { type: String, required: true, index: true },
    titleSnapshot: { type: String, required: true },
    raritySnapshot: { type: String, required: true },
    xpValueSnapshot: { type: Number, required: true },
    awardedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    awardedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

StudentBadgeSchema.index({ studentUserId: 1, badgeKey: 1 }, { unique: true });

export default mongoose.model("StudentBadge", StudentBadgeSchema);
