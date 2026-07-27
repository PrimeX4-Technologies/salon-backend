import type { Types } from "mongoose";

import type { IOutboxEvent } from "../models/events/OutboxEvent.js";
import { ApiError } from "../utils/ApiError.js";

export interface PublishableEvent {
  eventId: string;
  aggregateType: IOutboxEvent["aggregateType"];
  aggregateId: Types.ObjectId;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export interface EventPublisher {
  publish(event: PublishableEvent): Promise<void>;
}

let configuredPublisher: EventPublisher | undefined;

export const registerEventPublisher = (publisher: EventPublisher): void => {
  if (configuredPublisher) {
    throw new Error("An event publisher is already registered");
  }
  configuredPublisher = publisher;
};

export const getEventPublisher = (): EventPublisher => {
  if (!configuredPublisher) {
    throw new ApiError(503, "Outbox publisher is not configured", {
      code: "OUTBOX_PUBLISHER_NOT_CONFIGURED",
      expose: true,
    });
  }
  return configuredPublisher;
};

export const hasEventPublisher = (): boolean =>
  configuredPublisher !== undefined;
