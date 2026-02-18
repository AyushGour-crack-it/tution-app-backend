import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: { type: String, default: "" },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["teacher", "student"], required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },
    avatarUrl: { type: String, default: "" },
    bio: { type: String, default: "" },
    fcmTokens: { type: [String], default: [] },
    bonusXp: { type: Number, default: 0 },
    lastDailyXpAt: { type: Date, default: null },
    lastBirthdayBonusYear: { type: Number, default: 0 },
    streakCount: { type: Number, default: 0 },
    lastActiveDate: { type: Date, default: null },
    totalXP: { type: Number, default: 0 },
    subjectXP: {
      type: Map,
      of: Number,
      default: {}
    },
    subjectLevel: {
      type: Map,
      of: Number,
      default: {}
    },
    studentApprovalStatus: {
      type: String,
      enum: ["approved", "pending", "rejected"],
      default: "approved"
    },
    studentReviewMessage: { type: String, default: "" },
    pendingStudentProfile: {
      dateOfBirth: { type: Date, default: null },
      schoolName: { type: String, default: "" },
      grade: { type: String, default: "" },
      address: { type: String, default: "" },
      guardianName: { type: String, default: "" },
      guardianPhone: { type: String, default: "" },
      guardianRelation: { type: String, default: "" },
      emergencyContact: { type: String, default: "" }
    },
    profileLikedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    lastLoginAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export default mongoose.model("User", UserSchema);
