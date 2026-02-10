import mongoose from "mongoose";

const SyllabusItemSchema = new mongoose.Schema(
  {
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "Class" },
    subject: { type: String, required: true },
    topic: { type: String, required: true },
    targetDate: { type: Date },
    status: { type: String, default: "planned" }
  },
  { timestamps: true }
);

export default mongoose.model("SyllabusItem", SyllabusItemSchema);
