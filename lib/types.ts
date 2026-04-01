import {
  ArtifactKind,
  DeliveryStatus,
  MessageChannel,
  OrderStatus,
  RenderJobStatus
} from "@prisma/client";

export type DashboardOrder = {
  id: string;
  receiptId: string;
  buyerName: string;
  status: OrderStatus;
  pilotListingEligible: boolean;
  pilotListingMatched: boolean;
  createdAt: Date;
  photoReceivedAt: Date | null;
  approvedAt: Date | null;
  deliveredAt: Date | null;
  uploadCount: number;
  latestUploadName: string | null;
  latestPreviewKey: string | null;
};

export type ReminderRule = {
  label: string;
  hoursAfterOrder: number;
};

export const DEFAULT_REMINDER_RULES: ReminderRule[] = [
  { label: "24h reminder", hoursAfterOrder: 24 },
  { label: "72h reminder", hoursAfterOrder: 72 },
  { label: "7d reminder", hoursAfterOrder: 24 * 7 }
];

export {
  ArtifactKind,
  DeliveryStatus,
  MessageChannel,
  OrderStatus,
  RenderJobStatus
};
