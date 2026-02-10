import mongoose from "mongoose";

const AttendanceSchema = new mongoose.Schema(
  {
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "Class" },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student" },
    date: { type: Date, required: true },
    status: { type: String, enum: ["present", "absent", "late"], default: "present" },
    note: { type: String, default: "" }
  },
  { timestamps: true }
);

AttendanceSchema.index({ classId: 1, studentId: 1, date: 1 }, { unique: true });

export default mongoose.model("Attendance", AttendanceSchema);
