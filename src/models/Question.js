import mongoose from "mongoose";

const QuestionSchema = new mongoose.Schema(
  {
    classLevel: { type: Number, required: true },
    subject: { type: String, required: true, trim: true },
    topic: { type: String, required: true, trim: true },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      required: true
    },
    question: { type: String, required: true, trim: true },
    options: [{ type: String, required: true }],
    correctAnswer: { type: Number, required: true },
    explanation: { type: String, required: true, trim: true },
    timesAttempted: { type: Number, default: 0 },
    timesCorrect: { type: Number, default: 0 }
  },
  { timestamps: true }
);

QuestionSchema.index({ classLevel: 1, subject: 1, difficulty: 1 });

export default mongoose.model("Question", QuestionSchema);
