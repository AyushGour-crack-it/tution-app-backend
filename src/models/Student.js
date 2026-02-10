import mongoose from "mongoose";

const ActivitySchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    date: { type: Date, required: true },
    notes: { type: String, default: "" }
  },
  { _id: false }
);

const GuardianSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, default: "" },
    email: { type: String, default: "" }
  },
  { _id: false }
);

const StudentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    rollNumber: { type: String, default: "" },
    grade: { type: String, default: "" },
    subjects: { type: [String], default: [] },
    guardian: { type: GuardianSchema, default: () => ({}) },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    address: { type: String, default: "" },
    activities: { type: [ActivitySchema], default: [] },
    joinedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

export default mongoose.model("Student", StudentSchema);
