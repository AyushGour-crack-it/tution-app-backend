import mongoose from "mongoose";

const ChatReportSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "ConversationMessage", required: true },
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reporterName: { type: String, default: "" },
    reason: { type: String, required: true },
    note: { type: String, default: "" },
    status: { type: String, enum: ["open", "resolved", "dismissed"], default: "open" },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    handledAt: { type: Date, default: null },
    resolutionNote: { type: String, default: "" }
  },
  { timestamps: true }
);

ChatReportSchema.index({ status: 1, createdAt: -1 });
ChatReportSchema.index({ conversationId: 1, createdAt: -1 });
ChatReportSchema.index({ messageId: 1, reporterId: 1 }, { unique: true });

export default mongoose.model("ChatReport", ChatReportSchema);
