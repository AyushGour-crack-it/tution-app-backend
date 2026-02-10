import mongoose from "mongoose";

const ReceiptSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    feeId: { type: mongoose.Schema.Types.ObjectId, ref: "Fee", required: true },
    amount: { type: Number, required: true },
    paidOn: { type: Date, default: Date.now },
    method: { type: String, default: "UPI" },
    reference: { type: String, default: "" }
  },
  { timestamps: true }
);

export default mongoose.model("Receipt", ReceiptSchema);
