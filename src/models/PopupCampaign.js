import mongoose from "mongoose";

const PopupCampaignSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, required: true, trim: true, maxlength: 800 },
    template: {
      type: String,
      enum: ["announcement", "celebration", "deadline", "festival", "achievement"],
      default: "announcement"
    },
    target: {
      type: String,
      enum: ["all_students", "single_student"],
      default: "all_students"
    },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },
    startAt: { type: Date, required: true },
    endAt: { type: Date, default: null },
    ctaLabel: { type: String, trim: true, maxlength: 30, default: "" },
    ctaUrl: { type: String, trim: true, maxlength: 500, default: "" },
    imageUrl: { type: String, trim: true, maxlength: 500, default: "" },
    showOncePerUser: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    priority: { type: Number, default: 0, min: 0, max: 100 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

PopupCampaignSchema.index({ isActive: 1, startAt: -1 });
PopupCampaignSchema.index({ target: 1, studentId: 1, startAt: -1 });

export default mongoose.model("PopupCampaign", PopupCampaignSchema);
