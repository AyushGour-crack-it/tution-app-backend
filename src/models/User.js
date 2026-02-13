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
    profileLikedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    lastLoginAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export default mongoose.model("User", UserSchema);
