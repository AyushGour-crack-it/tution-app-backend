import mongoose from "mongoose";

const ClassSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    grade: { type: String, default: "" },
    subjects: { type: [String], default: [] },
    schedule: { type: String, default: "" },
    notes: { type: String, default: "" }
  },
  { timestamps: true }
);

export default mongoose.model("Class", ClassSchema);
