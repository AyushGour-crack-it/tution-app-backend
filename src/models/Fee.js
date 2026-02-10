import mongoose from "mongoose";

const PaymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true },
    paidOn: { type: Date, default: Date.now },
    note: { type: String, default: "" }
  },
  { _id: false }
);

const FeeSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student" },
    month: { type: String, required: true },
    total: { type: Number, required: true },
    payments: { type: [PaymentSchema], default: [] }
  },
  { timestamps: true }
);

export default mongoose.model("Fee", FeeSchema);
