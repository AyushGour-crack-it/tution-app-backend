import mongoose from "mongoose";

const ReactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    emoji: { type: String, required: true }
  },
  { _id: false }
);

const MessageSchema = new mongoose.Schema(
  {
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    senderName: { type: String, required: true },
    role: { type: String, enum: ["teacher", "student"], required: true },
    clientMessageId: { type: String, default: "" },
    recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    recipientStudentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },
    recipientName: { type: String, default: "" },
    type: {
      type: String,
      enum: ["text", "image", "audio", "video", "gif", "meme", "announcement"],
      required: true
    },
    content: { type: String, required: true },
    fileName: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    reactions: { type: [ReactionSchema], default: [] },
    readBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
    editedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export default mongoose.model("Message", MessageSchema);
