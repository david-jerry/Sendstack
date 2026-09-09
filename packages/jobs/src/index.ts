import { queueCampaign } from "./functions/queue-campaign";
import { sendCampaign } from "./functions/send-campaign";
import {
  cancelCampaign,
  reconcileCampaignStats,
  reconcileSent,
  scheduleDueCampaigns,
} from "./functions/scheduler";
import {
  expireAttachmentUrls,
  fetchInbound,
  reconcileInbound,
  wakeSnoozedThreads,
} from "./functions/fetch-inbound";

export {
  applyInngestConfig,
  campaignCancelRequested,
  campaignQueueRequested,
  campaignSendRequested,
  eventData,
  inboundReceived,
  inngest,
  sendEvent,
} from "./client";

/** Everything the Inngest route handler serves. Add new functions here. */
export const functions = [
  queueCampaign,
  sendCampaign,
  scheduleDueCampaigns,
  reconcileCampaignStats,
  reconcileSent,
  cancelCampaign,
  fetchInbound,
  reconcileInbound,
  wakeSnoozedThreads,
  expireAttachmentUrls,
];

export {
  queueCampaign,
  sendCampaign,
  scheduleDueCampaigns,
  reconcileCampaignStats,
  reconcileSent,
  cancelCampaign,
  fetchInbound,
  reconcileInbound,
  wakeSnoozedThreads,
  expireAttachmentUrls,
};

export { syncSentEmails, type SentSyncResult } from "./outbound-store";

export {
  recordInboundEmail,
  announceInboundEmail,
  syncInboundEmails,
  type DbExecutor,
  type InboundMetadata,
  type RecordResult,
  type SyncResult,
} from "./inbound-store";

export { recipientStatusCase, outboundStatusCase, eventAdvancesCase } from "./delivery-sql";
