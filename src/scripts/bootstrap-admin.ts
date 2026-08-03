import mongoose from "mongoose";

import { connectDB, disconnectDB } from "../config/database.js";
import StaffAccess, {
  STAFF_PERMISSIONS,
} from "../models/access/StaffAccess.js";
import User from "../models/auth/User.js";
import { customerRegistrationSchema } from "../validation/auth.schemas.js";

const readOptional = (name: string): string | undefined =>
  process.env[name]?.trim() || undefined;

const readRequired = (name: string): string => {
  const value = readOptional(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const transactionUnsupported = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: number;
    codeName?: string;
    message?: string;
  };
  return (
    candidate.code === 20 ||
    candidate.codeName === "IllegalOperation" ||
    candidate.message?.includes(
      "Transaction numbers are only allowed on a replica set member",
    ) === true
  );
};

const assertNoExistingAdmin = async (
  session?: mongoose.ClientSession,
): Promise<void> => {
  const query = User.exists({ role: "admin" });
  if (session) query.session(session);
  if (await query) {
    throw new Error(
      "An administrator already exists. Create additional administrators through the authenticated API.",
    );
  }
};

const createAdmin = async (
  input: {
    name: string;
    email?: string;
    phone?: string;
    password: string;
  },
  session?: mongoose.ClientSession,
): Promise<string> => {
  const user = new User({
    ...input,
    role: "admin",
    authMethods: ["local"],
  });
  await user.save({ session });

  try {
    await new StaffAccess({
      userId: user._id,
      permissions: [...STAFF_PERMISSIONS],
      allBranches: true,
      branchIds: [],
      status: "active",
      joinedAt: new Date(),
    }).save({ session });
  } catch (error) {
    if (!session) await User.deleteOne({ _id: user._id });
    throw error;
  }

  return user.id;
};

const main = async (): Promise<void> => {
  const input = customerRegistrationSchema.parse({
    name: readRequired("BOOTSTRAP_ADMIN_NAME"),
    email: readOptional("BOOTSTRAP_ADMIN_EMAIL"),
    phone: readOptional("BOOTSTRAP_ADMIN_PHONE"),
    password: readRequired("BOOTSTRAP_ADMIN_PASSWORD"),
  });

  await connectDB();

  let adminId: string | undefined;
  try {
    await mongoose.connection.transaction(async (session) => {
      await assertNoExistingAdmin(session);
      adminId = await createAdmin(input, session);
    });
  } catch (error) {
    if (!transactionUnsupported(error)) throw error;
    await assertNoExistingAdmin();
    adminId = await createAdmin(input);
  }

  if (!adminId) throw new Error("Administrator bootstrap did not complete");
  console.info(`Initial administrator created: ${adminId}`);
  console.info(
    "Remove BOOTSTRAP_ADMIN_PASSWORD from the environment before starting the API.",
  );
};

try {
  await main();
  await disconnectDB();
  process.exitCode = 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Administrator bootstrap failed");
  await disconnectDB().catch(() => undefined);
  process.exitCode = 1;
}
