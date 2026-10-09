import { commandFn } from "./command";
import {
  auditFn,
  changeDecidedFn,
  dailySyncCron,
  dispatchTasksCron,
  executeTaskFn,
  expireProposalsCron,
  measureTaskFn,
  monthlyReportCron,
  planCampaignFn,
  reportFn,
  scanClientFn,
  syncClientFn,
  weeklyAuditCron,
  weeklyScanCron,
} from "./seo";
import { editSite, generateSite } from "./site";

export const functions = [
  generateSite,
  editSite,
  planCampaignFn,
  executeTaskFn,
  changeDecidedFn,
  measureTaskFn,
  dispatchTasksCron,
  dailySyncCron,
  syncClientFn,
  weeklyAuditCron,
  auditFn,
  weeklyScanCron,
  scanClientFn,
  monthlyReportCron,
  reportFn,
  expireProposalsCron,
  commandFn,
];
