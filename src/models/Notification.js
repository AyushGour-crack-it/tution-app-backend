import mongoose from "mongoose";
import { emitNotificationCreated } from "../utils/realtime.js";
import { sendPushByTarget } from "../utils/pushNotifications.js";

const NotificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    message: { type: String, required: true },
    target: { type: String, enum: ["all", "student", "teacher"], default: "all" },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },
    readBy: { type: [mongoose.Schema.Types.ObjectId], ref: "User", default: [] },
    dismissedBy: { type: [mongoose.Schema.Types.ObjectId], ref: "User", default: [] }
  },
  { timestamps: true }
);

NotificationSchema.pre("save", function markIfNew(next) {
  this.$locals = this.$locals || {};
  this.$locals.wasNew = this.isNew;
  next();
});

NotificationSchema.post("save", function emitOnCreate(doc) {
  if (!doc?.$locals?.wasNew) return;
  emitNotificationCreated(doc);
  sendPushByTarget({
    target: doc.target,
    studentId: doc.studentId,
    title: doc.title,
    body: doc.message,
    data: {
      type: "notification",
      notificationId: doc._id?.toString() || "",
      clickAction: "/notifications"
    }
  });
});

export default mongoose.model("Notification", NotificationSchema);
