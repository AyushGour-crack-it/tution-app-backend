import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    message: { type: String, required: true },
    target: { type: String, enum: ["all", "student", "teacher"], default: "all" },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },
    readBy: { type: [mongoose.Schema.Types.ObjectId], ref: "User", default: [] }
  },
  { timestamps: true }
);

export default mongoose.model("Notification", NotificationSchema);
