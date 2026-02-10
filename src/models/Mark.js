import mongoose from "mongoose";

const MarkSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    subject: { type: String, required: true },
    assessment: { type: String, required: true },
    score: { type: Number, required: true },
    maxScore: { type: Number, required: true },
    grade: { type: String, default: "" },
    date: { type: Date, default: Date.now },
    notes: { type: String, default: "" }
  },
  { timestamps: true }
);

export default mongoose.model("Mark", MarkSchema);
