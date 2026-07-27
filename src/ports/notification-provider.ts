import { ApiError } from "../utils/ApiError.js";

export type NotificationChannel = "email" | "sms" | "whatsapp" | "push";

export interface NotificationDelivery {
  notificationId: string;
  channel: NotificationChannel;
  destination: string;
  subject?: string;
  body: string;
  locale: string;
}

export interface NotificationDeliveryResult {
  providerMessageId: string;
  acceptedAt: Date;
}

export interface NotificationProviderAdapter {
  readonly channel: NotificationChannel;
  send(delivery: NotificationDelivery): Promise<NotificationDeliveryResult>;
}

const adapters = new Map<NotificationChannel, NotificationProviderAdapter>();

export const registerNotificationProvider = (
  adapter: NotificationProviderAdapter,
): void => {
  if (adapters.has(adapter.channel)) {
    throw new Error(
      `Notification channel '${adapter.channel}' is already registered`,
    );
  }
  adapters.set(adapter.channel, adapter);
};

export const getNotificationProvider = (
  channel: NotificationChannel,
): NotificationProviderAdapter => {
  const adapter = adapters.get(channel);
  if (!adapter) {
    throw new ApiError(503, "Notification provider is not configured", {
      code: "NOTIFICATION_PROVIDER_NOT_CONFIGURED",
      details: { channel },
      expose: true,
    });
  }
  return adapter;
};

export const listConfiguredNotificationChannels =
  (): NotificationChannel[] => [...adapters.keys()].sort();

