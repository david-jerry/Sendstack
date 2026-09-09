export * from "./constants";
export * from "./enums";
export * from "./email-address";
export * from "./realtime";
export * from "./text";
export * from "./merge-fields";
export * from "./schemas";
export * from "./templates";
export * from "./custom-templates";

/**
 * Named rather than `export *`, unlike every line above it.
 *
 * `delivery-status.ts` re-exports the four status names it works with from
 * `./enums`, so a second `export *` here would offer `RECIPIENT_STATUSES` and
 * friends from two sources — an ambiguous re-export, which TypeScript reports
 * as an error rather than picking a winner. Listing what this module *adds*
 * keeps `./enums` the single place those vocabularies come from.
 *
 * So: a new module gets `export *` like the rest, unless it re-exports
 * something a sibling already publishes.
 */
export {
  DELIVERY_EVENT_NAMES,
  PROVIDER_EVENT_NAMES,
  bareEvent,
  eventAdvances,
  isDeliveryEventName,
  nextOutboundStatus,
  nextRecipientStatus,
  outboundStatusForEvent,
  recipientStatusForEvent,
  type DeliveryEventName,
} from "./delivery-status";
