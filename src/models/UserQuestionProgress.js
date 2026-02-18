import mongoose from "mongoose";

const UserQuestionProgressSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    question: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
    isCorrect: { type: Boolean, default: false },
    attempts: { type: Number, default: 1 },
    lastAttempted: { type: Date, default: Date.now },
    correctCount: { type: Number, default: 0 },
    masteredUntil: { type: Date, default: null }
  },
  { timestamps: true }
);

UserQuestionProgressSchema.index({ user: 1, question: 1 }, { unique: true });

export default mongoose.model("UserQuestionProgress", UserQuestionProgressSchema);
