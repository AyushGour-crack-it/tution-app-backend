import mongoose from "mongoose";

const ConversationMemberSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["admin", "member"], default: "member" },
    joinedAt: { type: Date, default: Date.now },
    lastReadAt: { type: Date, default: null },
    leftAt: { type: Date, default: null }
  },
  { _id: false }
);

const ConversationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["direct", "group"], required: true },
    participantKey: { type: String, default: "" },
    title: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    members: { type: [ConversationMemberSchema], default: [] },
    lastMessageAt: { type: Date, default: null },
    lastMessagePreview: { type: String, default: "" },
    lastMessageSenderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    lastMessageSenderName: { type: String, default: "" }
  },
  { timestamps: true }
);

ConversationSchema.index({ "members.userId": 1, updatedAt: -1 });
ConversationSchema.index({ type: 1, participantKey: 1 }, { unique: true, sparse: true });

export default mongoose.model("Conversation", ConversationSchema);
