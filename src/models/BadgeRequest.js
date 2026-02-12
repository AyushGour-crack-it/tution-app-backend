import mongoose from "mongoose";

const BadgeRequestSchema = new mongoose.Schema(
  {
    studentUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    badgeKey: { type: String, required: true, index: true },
    requestMessage: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true
    },
    teacherMessage: { type: String, default: "" },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

BadgeRequestSchema.index(
  { studentUserId: 1, badgeKey: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" }
  }
);

export default mongoose.model("BadgeRequest", BadgeRequestSchema);
