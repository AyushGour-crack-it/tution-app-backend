import mongoose from "mongoose";

const PaymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true },
    paidOn: { type: Date, default: Date.now },
    note: { type: String, default: "" },
    method: { type: String, default: "UPI" },
    reference: { type: String, default: "" },
    source: { type: String, enum: ["online", "offline", "manual"], default: "manual" },
    dueDateSnapshot: { type: Date, default: null },
    lateDays: { type: Number, default: 0 },
    xpAwarded: { type: Number, default: 0 },
    timingStatus: { type: String, enum: ["early", "on_time", "late"], default: "on_time" },
    timingDays: { type: Number, default: 0 }
  },
  { _id: false }
);

const FeeSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student" },
    month: { type: String, required: true },
    monthKey: { type: String, default: "" },
    total: { type: Number, required: true },
    dueDate: { type: Date, default: null },
    payments: { type: [PaymentSchema], default: [] }
  },
  { timestamps: true }
);

FeeSchema.index({ studentId: 1, monthKey: 1 }, { unique: true, sparse: true });

export default mongoose.model("Fee", FeeSchema);
