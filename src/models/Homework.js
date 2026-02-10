import mongoose from "mongoose";

const HomeworkSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "Class" },
    dueDate: { type: Date, required: true },
    description: { type: String, default: "" },
    attachments: { type: [String], default: [] }
  },
  { timestamps: true }
);

export default mongoose.model("Homework", HomeworkSchema);
