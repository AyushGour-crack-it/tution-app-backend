import mongoose from "mongoose";

const ReactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    emoji: { type: String, required: true }
  },
  { _id: false }
);

const ConversationMessageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    senderName: { type: String, required: true },
    senderAvatar: { type: String, default: "" },
    senderRole: { type: String, enum: ["teacher", "student"], required: true },
    clientMessageId: { type: String, default: "" },
    type: {
      type: String,
      enum: ["text", "image", "audio", "video", "gif", "meme", "announcement"],
      required: true
    },
    content: { type: String, required: true },
    fileName: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "ConversationMessage", default: null },
    reactions: { type: [ReactionSchema], default: [] },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { timestamps: true }
);

ConversationMessageSchema.index({ conversationId: 1, createdAt: -1 });
ConversationMessageSchema.index({ senderId: 1, createdAt: -1 });

export default mongoose.model("ConversationMessage", ConversationMessageSchema);
