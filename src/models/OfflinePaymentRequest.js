import mongoose from "mongoose";

const OfflinePaymentRequestSchema = new mongoose.Schema(
  {
    feeId: { type: mongoose.Schema.Types.ObjectId, ref: "Fee", required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    studentUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true },
    message: { type: String, default: "" },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    teacherNote: { type: String, default: "" },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export default mongoose.model("OfflinePaymentRequest", OfflinePaymentRequestSchema);
