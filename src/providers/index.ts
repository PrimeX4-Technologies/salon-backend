/**
 * Provider composition root.
 *
 * Deployments register concrete payment, notification, ERP/calendar, and
 * event-publisher adapters here. The core deliberately registers no pretend
 * providers: queues remain untouched when an adapter is not configured.
 */
export {};

