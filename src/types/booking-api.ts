import type { UserRole } from "../models/auth/User.js";
import type { AuditActorContext } from "../services/audit.service.js";

export interface BookingStaffScope {
  allBranches: boolean;
  branchIds: string[];
}

export interface BookingRequestActor {
  userId: string;
  role: UserRole;
  staffScope?: BookingStaffScope;
}

export interface BookingRequestContext {
  actor: BookingRequestActor;
  audit: AuditActorContext;
}

