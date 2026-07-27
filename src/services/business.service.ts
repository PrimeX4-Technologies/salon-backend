import { Types, type ClientSession, type QueryFilter } from "mongoose";

import type {
  BranchCreateInput,
  BranchHoursCreateInput,
  BranchHoursUpdateInput,
  BranchUpdateInput,
  BusinessBootstrapInput,
  BusinessProfileInput,
  BusinessSettingsInput,
} from "../api/validators/business.validators.js";
import Branch, { type IBranch } from "../models/business/Branch.js";
import BusinessProfile from "../models/business/BusinessProfile.js";
import BusinessSettings from "../models/business/BusinessSettings.js";
import BranchService from "../models/catalog/BranchService.js";
import BranchHours, { type IBranchHours } from "../models/scheduling/BranchHours.js";
import { ApiError } from "../utils/ApiError.js";
import { withTransaction } from "../utils/database.js";
import { currentSystemDate } from "../utils/dateTime.js";
import {
  buildPaginationMeta,
  escapeRegExp,
  parsePagination,
  type PaginationMeta,
} from "../utils/pagination.js";
import {
  withBookingConfigWriteLease,
  withBookingConfigWriteLeases,
} from "./booking-config-lock.service.js";
import {
  recordAudit,
  type AuditActorContext,
} from "./audit.service.js";

interface ListResult<T> {
  data: T[];
  pagination: PaginationMeta;
}

interface BranchListQuery {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
  bookingsEnabled?: boolean;
  branchIds?: string[];
}

interface BranchHoursListQuery {
  page?: number;
  limit?: number;
  status?: "draft" | "active" | "archived";
  effectiveOn?: string;
}

const BUSINESS_SINGLETON_KEY = "default" as const;

const changedFields = (input: Record<string, unknown>): string[] =>
  Object.keys(input).sort();

const listAllBranchIds = async (): Promise<Types.ObjectId[]> => {
  const branches = await Branch.find({}).select("_id").lean();
  return branches.map((branch) => branch._id);
};

const normalizeOptionalFields = <T extends Record<string, unknown>>(payload: T): T => {
  const normalized = { ...payload };
  Object.entries(normalized).forEach(([key, value]) => {
    if (value === null) {
      (normalized as Record<string, unknown>)[key] = undefined;
    }
  });
  return normalized;
};

const assertCompleteWeek = (days: Array<{ dayOfWeek: number }>): void => {
  const uniqueDays = new Set(days.map((day) => day.dayOfWeek));
  if (uniqueDays.size !== 7 || [...uniqueDays].some((day) => day < 0 || day > 6)) {
    throw ApiError.badRequest(
      "Branch hours must contain each weekday exactly once",
      undefined,
      "INCOMPLETE_BRANCH_HOURS",
    );
  }
};

const requireBranch = async (branchId: string, session?: ClientSession) => {
  const branch = await Branch.findById(branchId).session(session ?? null);
  if (!branch) throw ApiError.notFound("Branch not found", "BRANCH_NOT_FOUND");
  return branch;
};

const assertBranchModeSupports = async (
  branchMode: "single" | "multiple",
  session?: ClientSession,
): Promise<void> => {
  if (branchMode !== "single") return;
  const activeBranchCount = await Branch.countDocuments({ isActive: true }).session(
    session ?? null,
  );
  if (activeBranchCount > 1) {
    throw ApiError.conflict(
      "Single-branch mode cannot be enabled while multiple active branches exist",
      { activeBranchCount },
      "BRANCH_MODE_CONFLICT",
    );
  }
};

const assertNoHoursOverlap = async (
  hours: Pick<IBranchHours, "branchId" | "effectiveFrom" | "effectiveUntil" | "status">,
  excludingId?: string,
  session?: ClientSession,
): Promise<void> => {
  if (hours.status !== "active") return;

  const filter: QueryFilter<IBranchHours> = {
    branchId: hours.branchId,
    status: "active",
    effectiveFrom: { $lt: hours.effectiveUntil ?? "9999-12-31" },
    $or: [
      { effectiveUntil: { $exists: false } },
      { effectiveUntil: null },
      { effectiveUntil: { $gt: hours.effectiveFrom } },
    ],
  };
  if (excludingId) filter._id = { $ne: excludingId };

  const overlapping = await BranchHours.exists(filter).session(session ?? null);
  if (overlapping) {
    throw ApiError.conflict(
      "Active branch-hours date ranges cannot overlap",
      undefined,
      "BRANCH_HOURS_OVERLAP",
    );
  }
};

export const getBusinessProfile = async () => {
  const profile = await BusinessProfile.findOne({ singletonKey: BUSINESS_SINGLETON_KEY })
    .select("-__v")
    .lean();
  if (!profile) {
    throw ApiError.notFound("Business profile has not been configured", "PROFILE_NOT_CONFIGURED");
  }
  return profile;
};

export const updateBusinessProfile = async (
  input: BusinessProfileInput,
  context: AuditActorContext,
) => {
  const profile =
    (await BusinessProfile.findOne({ singletonKey: BUSINESS_SINGLETON_KEY })) ??
    new BusinessProfile({ singletonKey: BUSINESS_SINGLETON_KEY });
  profile.set(normalizeOptionalFields(input));
  await profile.save();
  await recordAudit({
    context,
    action: "business_profile.updated",
    entityType: "BusinessProfile",
    entityId: profile._id,
    changes: { changedFields: changedFields(input) },
  });
  return profile;
};

export const getBusinessSettings = async () => {
  const settings = await BusinessSettings.findOne({ singletonKey: BUSINESS_SINGLETON_KEY })
    .select("-__v")
    .lean();
  if (!settings) {
    throw ApiError.notFound(
      "Business settings have not been configured",
      "SETTINGS_NOT_CONFIGURED",
    );
  }
  return settings;
};

export const updateBusinessSettings = async (
  input: BusinessSettingsInput,
  context: AuditActorContext,
) => {
  const branchIds = await listAllBranchIds();
  return withBookingConfigWriteLeases(
    branchIds,
    async (guard) =>
      withTransaction(async (session) => {
        const settings =
          (await BusinessSettings.findOne({
            singletonKey: BUSINESS_SINGLETON_KEY,
          }).session(session)) ??
          new BusinessSettings({ singletonKey: BUSINESS_SINGLETON_KEY });

        const primaryBranchId =
          input.primaryBranchId ?? settings.primaryBranchId?.toString();
        if (!primaryBranchId) {
          throw ApiError.badRequest(
            "primaryBranchId is required when creating business settings",
            undefined,
            "PRIMARY_BRANCH_REQUIRED",
          );
        }

        const primaryBranch = await requireBranch(primaryBranchId, session);
        if (!primaryBranch.isActive) {
          throw ApiError.conflict(
            "The primary branch must be active",
            undefined,
            "PRIMARY_BRANCH_INACTIVE",
          );
        }

        const branchMode = input.branchMode ?? settings.branchMode ?? "single";
        await assertBranchModeSupports(branchMode, session);

        const normalized = normalizeOptionalFields(input);
        const nestedFields = ["booking", "customerAuth", "reminders"] as const;
        const currentSettings = settings.toObject();
        nestedFields.forEach((field) => {
          const patch = normalized[field];
          if (patch) {
            settings.set(field, {
              ...(currentSettings[field] ?? {}),
              ...patch,
            });
            delete normalized[field];
          }
        });
        settings.set(normalized);
        settings.primaryBranchId = primaryBranch._id;
        settings.branchMode = branchMode;

        await Branch.updateMany(
          { _id: { $ne: primaryBranch._id }, isPrimary: true },
          { $set: { isPrimary: false } },
          { session },
        );
        primaryBranch.isPrimary = true;
        await primaryBranch.save({ session });
        await settings.save({ session });
        await recordAudit(
          {
            context,
            action: "business_settings.updated",
            entityType: "BusinessSettings",
            entityId: settings._id,
            changes: {
              changedFields: changedFields(input),
              primaryBranchId: primaryBranch._id.toString(),
              branchMode: settings.branchMode,
            },
          },
          session,
        );
        await guard.assertValid();
        return settings;
      }),
  );
};

export const bootstrapBusiness = async (
  input: BusinessBootstrapInput,
  context: AuditActorContext,
) =>
  withTransaction(async (session) => {
    const [profileExists, settingsExists, branchExists] = await Promise.all([
      BusinessProfile.exists({ singletonKey: BUSINESS_SINGLETON_KEY }).session(session),
      BusinessSettings.exists({ singletonKey: BUSINESS_SINGLETON_KEY }).session(session),
      Branch.exists({}).session(session),
    ]);
    if (profileExists || settingsExists || branchExists) {
      throw ApiError.conflict(
        "Business bootstrap has already been completed",
        undefined,
        "BUSINESS_ALREADY_BOOTSTRAPPED",
      );
    }

    const [profile] = await BusinessProfile.create(
      [{ ...input.profile, singletonKey: BUSINESS_SINGLETON_KEY }],
      { session },
    );
    const [branch] = await Branch.create(
      [
        {
          ...input.primaryBranch,
          isPrimary: true,
          isActive: true,
        },
      ],
      { session },
    );
    const [settings] = await BusinessSettings.create(
      [
        {
          ...input.settings,
          singletonKey: BUSINESS_SINGLETON_KEY,
          primaryBranchId: branch._id,
        },
      ],
      { session },
    );
    await recordAudit(
      {
        context,
        action: "business.bootstrapped",
        entityType: "BusinessProfile",
        entityId: profile._id,
        changes: {
          branchId: branch._id.toString(),
          settingsId: settings._id.toString(),
          branchMode: settings.branchMode,
          currency: settings.currency,
        },
      },
      session,
    );
    return { profile, branch, settings };
  });

export const getBusinessOverview = async () => {
  const [profile, settings, branches] = await Promise.all([
    BusinessProfile.findOne({
      singletonKey: BUSINESS_SINGLETON_KEY,
      status: "active",
    })
      .select("name legalName slug email phone websiteUrl logoUrl registeredAddress")
      .lean(),
    BusinessSettings.findOne({ singletonKey: BUSINESS_SINGLETON_KEY })
      .select("branchMode locale currency finalPaymentHandling booking")
      .lean(),
    Branch.find({ isActive: true })
      .select("name code email phone address isPrimary bookingsEnabled")
      .sort({ isPrimary: -1, name: 1 })
      .lean(),
  ]);
  if (!profile) {
    throw ApiError.notFound("Business profile is unavailable", "BUSINESS_UNAVAILABLE");
  }
  return { profile, settings, branches };
};

export const listBranches = async (
  query: BranchListQuery,
): Promise<ListResult<unknown>> => {
  const pagination = parsePagination(query as Record<string, unknown>);
  const filter: QueryFilter<IBranch> = {};
  if (query.branchIds) filter._id = { $in: query.branchIds };
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.bookingsEnabled !== undefined) {
    filter.bookingsEnabled = query.bookingsEnabled;
  }
  if (query.search) {
    const search = new RegExp(escapeRegExp(query.search), "i");
    filter.$or = [{ name: search }, { code: search }, { email: search }, { phone: search }];
  }

  const [data, total] = await Promise.all([
    Branch.find(filter)
      .select("-__v")
      .sort({ isPrimary: -1, name: 1, _id: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    Branch.countDocuments(filter),
  ]);
  return { data, pagination: buildPaginationMeta(total, pagination) };
};

export const getBranch = async (branchId: string, publicOnly = false) => {
  const filter: QueryFilter<IBranch> = { _id: branchId };
  if (publicOnly) filter.isActive = true;
  const branch = await Branch.findOne(filter).select("-__v").lean();
  if (!branch) throw ApiError.notFound("Branch not found", "BRANCH_NOT_FOUND");
  return branch;
};

export const createBranch = async (
  input: BranchCreateInput,
  context: AuditActorContext,
) => {
  const newBranchId = new Types.ObjectId();
  const branchIds = [...(await listAllBranchIds()), newBranchId];
  return withBookingConfigWriteLeases(
    branchIds,
    async (guard) =>
      withTransaction(async (session) => {
        const [branchCount, activeBranchCount, settings] = await Promise.all([
          Branch.countDocuments({}).session(session),
          Branch.countDocuments({ isActive: true }).session(session),
          BusinessSettings.findOne({
            singletonKey: BUSINESS_SINGLETON_KEY,
          }).session(session),
        ]);
        const mustBePrimary = branchCount === 0;
        const willBeActive = input.isActive ?? true;
        const makePrimary = mustBePrimary || input.isPrimary === true;

        if (
          settings?.branchMode === "single" &&
          activeBranchCount > 0 &&
          willBeActive
        ) {
          throw ApiError.conflict(
            "Enable multiple-branch mode before adding another active branch",
            undefined,
            "SINGLE_BRANCH_MODE",
          );
        }
        if (makePrimary && !willBeActive) {
          throw ApiError.badRequest(
            "The primary branch must be active",
            undefined,
            "PRIMARY_BRANCH_INACTIVE",
          );
        }

        if (makePrimary) {
          await Branch.updateMany(
            { isPrimary: true },
            { $set: { isPrimary: false } },
            { session },
          );
        }
        const [branch] = await Branch.create(
          [
            {
              _id: newBranchId,
              ...input,
              isPrimary: makePrimary,
              ...(!willBeActive ? { bookingsEnabled: false } : {}),
            },
          ],
          { session },
        );

        if (makePrimary) {
          if (settings) {
            settings.primaryBranchId = branch._id;
            await settings.save({ session });
          } else {
            await BusinessSettings.create(
              [
                {
                  singletonKey: BUSINESS_SINGLETON_KEY,
                  primaryBranchId: branch._id,
                },
              ],
              { session },
            );
          }
        }
        await recordAudit(
          {
            context,
            action: "branch.created",
            entityType: "Branch",
            entityId: branch._id,
            changes: {
              code: branch.code,
              isPrimary: branch.isPrimary,
              isActive: branch.isActive,
              bookingsEnabled: branch.bookingsEnabled,
            },
          },
          session,
        );
        await guard.assertValid();
        return branch;
      }),
  );
};

export const updateBranch = async (
  branchId: string,
  input: BranchUpdateInput,
  context: AuditActorContext,
) => {
  const mutate = (assertValid: () => Promise<void>) =>
    withTransaction(async (session) => {
      const branch = await requireBranch(branchId, session);
      const normalized = normalizeOptionalFields(input);
      const makePrimary = input.isPrimary === true && !branch.isPrimary;

      if (branch.isPrimary && input.isPrimary === false) {
        throw ApiError.conflict(
          "Assign another primary branch instead of unsetting the current primary",
          undefined,
          "PRIMARY_BRANCH_REQUIRED",
        );
      }
      if (branch.isPrimary && input.isActive === false) {
        throw ApiError.conflict(
          "The primary branch cannot be deactivated",
          undefined,
          "PRIMARY_BRANCH_ACTIVE",
        );
      }

      const willBeActive = input.isActive ?? branch.isActive;
      if (!willBeActive && input.bookingsEnabled === true) {
        throw ApiError.badRequest(
          "An inactive branch cannot accept bookings",
          undefined,
          "INACTIVE_BRANCH_BOOKINGS",
        );
      }
      if (input.isActive === true && !branch.isActive) {
        const [settings, otherActiveBranches] = await Promise.all([
          BusinessSettings.findOne({ singletonKey: BUSINESS_SINGLETON_KEY })
            .select("branchMode")
            .session(session),
          Branch.countDocuments({ _id: { $ne: branch._id }, isActive: true }).session(
            session,
          ),
        ]);
        if (settings?.branchMode === "single" && otherActiveBranches > 0) {
          throw ApiError.conflict(
            "Enable multiple-branch mode before activating another branch",
            undefined,
            "SINGLE_BRANCH_MODE",
          );
        }
      }
      if (makePrimary && !willBeActive) {
        throw ApiError.badRequest(
          "The primary branch must be active",
          undefined,
          "PRIMARY_BRANCH_INACTIVE",
        );
      }

      branch.set(normalized);
      if (!willBeActive) branch.bookingsEnabled = false;

      if (makePrimary) {
        await Branch.updateMany(
          { _id: { $ne: branch._id }, isPrimary: true },
          { $set: { isPrimary: false } },
          { session },
        );
        branch.isPrimary = true;
        const settings = await BusinessSettings.findOne({
          singletonKey: BUSINESS_SINGLETON_KEY,
        }).session(session);
        if (settings) {
          settings.primaryBranchId = branch._id;
          await settings.save({ session });
        } else {
          await BusinessSettings.create(
            [
              {
                singletonKey: BUSINESS_SINGLETON_KEY,
                primaryBranchId: branch._id,
              },
            ],
            { session },
          );
        }
      }

      await branch.save({ session });
      await recordAudit(
        {
          context,
          action: "branch.updated",
          entityType: "Branch",
          entityId: branch._id,
          changes: {
            changedFields: changedFields(input),
            isPrimary: branch.isPrimary,
            isActive: branch.isActive,
            bookingsEnabled: branch.bookingsEnabled,
          },
        },
        session,
      );
      await assertValid();
      return branch;
    });

  return input.isActive !== undefined || input.bookingsEnabled !== undefined
    ? withBookingConfigWriteLease(branchId, (guard) =>
        mutate(() => guard.assertValid()),
      )
    : mutate(() => Promise.resolve());
};

export const archiveBranch = async (
  branchId: string,
  context: AuditActorContext,
) =>
  withBookingConfigWriteLease(
    branchId,
    async (guard) =>
      withTransaction(async (session) => {
        const branch = await requireBranch(branchId, session);
        if (branch.isPrimary) {
          throw ApiError.conflict(
            "Assign another primary branch before archiving this branch",
            undefined,
            "PRIMARY_BRANCH_ARCHIVE_FORBIDDEN",
          );
        }
        branch.isActive = false;
        branch.bookingsEnabled = false;
        await branch.save({ session });
        await BranchService.updateMany(
          { branchId: branch._id },
          { $set: { isActive: false, isOnlineBookable: false } },
          { session },
        );
        await recordAudit(
          {
            context,
            action: "branch.archived",
            entityType: "Branch",
            entityId: branch._id,
            changes: {
              isActive: false,
              bookingsEnabled: false,
              branchServicesDisabled: true,
            },
          },
          session,
        );
        await guard.assertValid();
        return branch;
      }),
  );

export const listBranchHours = async (
  branchId: string,
  query: BranchHoursListQuery,
): Promise<ListResult<unknown>> => {
  await requireBranch(branchId);
  const pagination = parsePagination(query as Record<string, unknown>);
  const filter: QueryFilter<IBranchHours> = { branchId };
  if (query.status) filter.status = query.status;
  if (query.effectiveOn) {
    filter.effectiveFrom = { $lte: query.effectiveOn };
    filter.$or = [
      { effectiveUntil: { $exists: false } },
      { effectiveUntil: null },
      { effectiveUntil: { $gt: query.effectiveOn } },
    ];
  }

  const [data, total] = await Promise.all([
    BranchHours.find(filter)
      .select("-__v")
      .sort({ effectiveFrom: -1, createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    BranchHours.countDocuments(filter),
  ]);
  return { data, pagination: buildPaginationMeta(total, pagination) };
};

export const getBranchHours = async (
  branchId: string,
  hoursId: string,
  publicOnly = false,
) => {
  const filter: QueryFilter<IBranchHours> = { _id: hoursId, branchId };
  if (publicOnly) filter.status = "active";
  const hours = await BranchHours.findOne(filter).select("-__v").lean();
  if (!hours) {
    throw ApiError.notFound("Branch hours version not found", "BRANCH_HOURS_NOT_FOUND");
  }
  return hours;
};

export const getCurrentBranchHours = async (
  branchId: string,
  effectiveOn = currentSystemDate(),
) => {
  const branch = await getBranch(branchId, true);
  const hours = await BranchHours.findOne({
    branchId,
    status: "active",
    effectiveFrom: { $lte: effectiveOn },
    $or: [
      { effectiveUntil: { $exists: false } },
      { effectiveUntil: null },
      { effectiveUntil: { $gt: effectiveOn } },
    ],
  })
    .select("-__v")
    .sort({ effectiveFrom: -1 })
    .lean();
  return { branch, hours, effectiveOn };
};

export const createBranchHours = async (
  branchId: string,
  input: BranchHoursCreateInput,
  context: AuditActorContext,
) =>
  withBookingConfigWriteLease(branchId, async (guard) => {
    const branch = await requireBranch(branchId);
    if (input.status === "active" && !branch.isActive) {
      throw ApiError.conflict(
        "Opening hours cannot be activated for an inactive branch",
        undefined,
        "BRANCH_INACTIVE",
      );
    }
    assertCompleteWeek(input.days);

    const hours = new BranchHours({
      ...normalizeOptionalFields(input),
      branchId: branch._id,
    });
    await hours.validate();
    await assertNoHoursOverlap(hours);
    await guard.assertValid();
    await hours.save();
    await recordAudit({
      context,
      action: "branch_hours.created",
      entityType: "BranchHours",
      entityId: hours._id,
      changes: {
        branchId: branch._id.toString(),
        status: hours.status,
        effectiveFrom: hours.effectiveFrom,
        effectiveUntil: hours.effectiveUntil,
      },
    });
    return hours;
  });

export const updateBranchHours = async (
  branchId: string,
  hoursId: string,
  input: BranchHoursUpdateInput,
  context: AuditActorContext,
) =>
  withBookingConfigWriteLease(branchId, async (guard) => {
    const [branch, hours] = await Promise.all([
      requireBranch(branchId),
      BranchHours.findOne({ _id: hoursId, branchId }),
    ]);
    if (!hours) {
      throw ApiError.notFound(
        "Branch hours version not found",
        "BRANCH_HOURS_NOT_FOUND",
      );
    }

    hours.set(normalizeOptionalFields(input));
    if (hours.status === "active" && !branch.isActive) {
      throw ApiError.conflict(
        "Opening hours cannot be activated for an inactive branch",
        undefined,
        "BRANCH_INACTIVE",
      );
    }
    assertCompleteWeek(hours.days);
    await hours.validate();
    await assertNoHoursOverlap(hours, hoursId);
    await guard.assertValid();
    await hours.save();
    await recordAudit({
      context,
      action: "branch_hours.updated",
      entityType: "BranchHours",
      entityId: hours._id,
      changes: {
        branchId,
        changedFields: changedFields(input),
        status: hours.status,
      },
    });
    return hours;
  });

export const archiveBranchHours = async (
  branchId: string,
  hoursId: string,
  context: AuditActorContext,
) =>
  withBookingConfigWriteLease(branchId, async (guard) => {
    const hours = await BranchHours.findOne({ _id: hoursId, branchId });
    if (!hours) {
      throw ApiError.notFound(
        "Branch hours version not found",
        "BRANCH_HOURS_NOT_FOUND",
      );
    }
    hours.status = "archived";
    await guard.assertValid();
    await hours.save();
    await recordAudit({
      context,
      action: "branch_hours.archived",
      entityType: "BranchHours",
      entityId: hours._id,
      changes: { branchId, status: hours.status },
    });
    return hours;
  });

export const businessService = {
  archiveBranch,
  archiveBranchHours,
  bootstrapBusiness,
  createBranch,
  createBranchHours,
  getBranch,
  getBranchHours,
  getBusinessOverview,
  getBusinessProfile,
  getBusinessSettings,
  getCurrentBranchHours,
  listBranches,
  listBranchHours,
  updateBranch,
  updateBranchHours,
  updateBusinessProfile,
  updateBusinessSettings,
};

export default businessService;
