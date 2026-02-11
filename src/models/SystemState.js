import mongoose from "mongoose";

const SystemStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: String, default: "" }
  },
  { timestamps: true }
);

export default mongoose.model("SystemState", SystemStateSchema);
