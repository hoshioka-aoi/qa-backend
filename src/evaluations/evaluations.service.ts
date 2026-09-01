import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";
import { Evaluation, EvaluationDocument } from "./schemas/evaluations.schema";
 
interface CriterionDef {
  key: string;
  label: string;
  critical: boolean;
}

export type Period = "week" | "month" | "year";


// Single source of truth for which fields are critical, and how they're
// labeled for display. Matches the column names produced by the CSV import
// (no more "1_1_" / "2_3_" number prefixes — those were dropped when the
// raw export was translated).
const CRITERIA: CriterionDef[] = [
  { key: "greeting_introduction_and_closing_per_standard", label: "กล่าวประโยคต้อนรับ แนะนำตัว และกล่าวจบการสนทนา ไม่ตามมาตรฐานที่กำหนด", critical: false },
  { key: "request_customer_name_and_phone_per_standard_critical_bus", label: "ขอชื่อ-นามสกุล เบอร์โทรลูกค้า/ผู้ติดต่อ ไม่ตามมาตรฐานที่กำหนด", critical: true },
  { key: "hold_call_per_standard", label: "ไม่พักสายตามมาตรฐานที่กำหนด", critical: false },
  { key: "summarize_service_issue_before_closing", label: "ไม่สรุปประเด็นการให้บริการ ก่อนจบการสนทนา", critical: false },
  { key: "communicate_information_clearly_critical_eu", label: "ไม่ถ่ายทอดข้อมูลให้เข้าใจง่าย", critical: true },
  { key: "correct_use_of_customer_name_pronoun", label: "การใช้สรรพนามเรียกชื่อลูกค้าผิด", critical: false },
  { key: "no_extraneous_noise_during_call", label: "มีเสียงอื่นที่เกิดขึ้นจากผู้ถูกประเมินดังลอดเข้าสายสนทนา", critical: false },
  { key: "enthusiasm_and_courtesy_in_service_critical_eu", label: "ไม่กระตือรือร้นและมารยาทในการให้บริการ ", critical: true },
  { key: "inquire_and_listen_to_identify_customer_needs_correctly_critical_eu", label: "การสอบถามข้อมูล และรับฟัง เพื่อจับประเด็นความต้องการของลูกค้าได้อย่างไม่ถูกต้อง", critical: true },
  { key: "communicate_and_resolve_issue_per_process_critical_eu", label: "ไม่สามารถถ่ายทอดข้อมูล แก้ไขปัญหา ได้ถูกต้องตามกระบวนการที่กำหนด ", critical: true },
  { key: "confirm_important_information_per_standard_critical_eu", label: "ย้ำทวนข้อมูลที่สำคัญ ไม่ตามมาตรฐานที่กำหนด", critical: true },
  { key: "check_service_history_for_continuity_critical_eu", label: "การตรวจสอบประวัติการใช้บริการและนำมาให้บริการไม่ได้อย่างต่อเนื่อง", critical: true },
  { key: "verify_important_information_per_requirement_critical_com", label: "การสอบถามข้อมูลที่ใช้ในการตรวจสอบ และ Verify ข้อมูลสำคัญไม่ตามข้อกำหนด", critical: true },
  { key: "maintain_organization_image_critical_bus", label: "ไม่รักษาภาพลักษณ์องค์กร", critical: true },
  { key: "up_selling_and_cross_selling", label: "ไม่มี Up-selling / cross-selling", critical: false },
  { key: "correct_field_selection_and_verification_critical_bus", label: "ความถูกต้องในการเลือก Field /การตรวจสอบ Field ไม่ตามที่กำหนด", critical: true },
  { key: "data_entry_accuracy_critical_bus", label: "ไม่มีความถูกต้องในการบันทึกข้อมูล", critical: true },
  { key: "follow_up_with_customer_per_standard_critical_eu", label: "ไม่ติดต่อกลับลูกค้าตามมาตรฐานหรือติดตามงานตามที่กำหนด", critical: true },
  { key: "close_case_and_handoff_correctly_critical_bus", label: "การปิดงาน/ส่งประสานงานไม่ถูกต้องครบถ้วน", critical: true },
];

const FAIL_VALUE = "ไม่เป็นไปตามมาตรฐาน";
 
// The raw-data collection has 144 columns; the aggregation logic below only
// ever reads this subset (the other ~115 are free-text audit/notes fields
// in Thai that we never use). Projecting them out at the query level cuts
// the payload MongoDB has to send — and the memory Node has to hold —
// down substantially, which is most of what makes the first (cold-cache)
// load slow.
const FIELD_PROJECTION = {
  evaluatee_full_name: 1,
  employee_email: 1,
  position: 1,
  department: 1,
  group: 1,
  evaluation_date: 1,
  evaluation_result: 1,
  score_sum: 1,
  status_acknowledge: 1,
  status_flow: 1,
  ...Object.fromEntries(CRITERIA.map((c) => [c.key, 1])),
};
 
@Injectable()
export class EvaluationsService implements OnModuleInit {
  private static readonly RECORDS_CACHE_KEY = "raw-data:all-records";
  private readonly logger = new Logger(EvaluationsService.name);
 
  constructor(
    @InjectModel(Evaluation.name)
    private readonly evaluationModel: Model<EvaluationDocument>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache
  ) {}
 
  // Runs once when the Nest app finishes booting — pre-loads the raw-data
  // cache immediately, so whoever's browser hits the dashboard/reports page
  // FIRST doesn't have to pay for the cold-cache fetch themselves. By the
  // time anyone can actually reach the frontend, this has usually already
  // finished in the background.
  async onModuleInit() {
    const start = Date.now();
    try {
      const records = await this.getAllRecords();
      this.logger.log(`Warmed raw-data cache: ${records.length} records in ${Date.now() - start}ms`);
    } catch (err) {
      this.logger.warn(`Cache warm-up failed (will retry on first request): ${err}`);
    }
 
    // Also pre-compute the summary for the most likely first clicks —
    // "All Departments" across all three periods — so switching This Week
    // / This Month / This Year is instant even before anyone's requested
    // that specific combo yet. Department-specific combos still compute
    // on first request (we don't know which department someone will pick),
    // but those are cheap once the raw-data cache above is warm.
    const periods: Period[] = ["week", "month", "year"];
    for (const p of periods) {
      const t = Date.now();
      try {
        await this.getDashboardSummary(undefined, p);
        this.logger.log(`Warmed dashboard summary (all, ${p}) in ${Date.now() - t}ms`);
      } catch (err) {
        this.logger.warn(`Summary warm-up failed for period=${p}: ${err}`);
      }
    }
  }
 
  // The one place that actually talks to MongoDB for the full collection.
  // Every method below calls this instead of querying directly, so a full
  // 26k-document scan happens at most once per cache TTL window instead of
  // once per request.
  private async getAllRecords(): Promise<any[]> {
    const cached = await this.cacheManager.get<any[]>(EvaluationsService.RECORDS_CACHE_KEY);
    if (cached) return cached;
 
    const start = Date.now();
    const records = await this.evaluationModel.find({}, FIELD_PROJECTION).lean();
    this.logger.log(`Cache MISS — fetched ${records.length} records from MongoDB in ${Date.now() - start}ms`);
    await this.cacheManager.set(EvaluationsService.RECORDS_CACHE_KEY, records);
    return records;
  }
 
  // Call this after a re-import of raw-data, or wire it to a webhook/cron
  // if the import pipeline can trigger it automatically. Without this, the
  // cache just naturally expires after the TTL set in AppModule.
  async invalidateCache() {
    await this.cacheManager.del(EvaluationsService.RECORDS_CACHE_KEY);
    // Per-department trend caches use dynamic keys (trend:<department>),
    // so there's no single key to clear here — they'll fall out naturally
    // after their own TTL. If exact invalidation matters later, this would
    // need to track department names separately or switch stores to one
    // that supports pattern-based deletion.
  }
 
  // Distinct department names, for the dashboard's department filter dropdown.
  async getDepartments(): Promise<string[]> {
    const records = await this.getAllRecords();
    const set = new Set<string>();
    for (const r of records) {
      const dep = typeof r.department === "string" ? r.department.trim() : "";
      if (dep) set.add(dep);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }
 
  async getDashboardSummary(department?: string, period: Period = "month") {
    const t0 = Date.now();
    const all = await this.getAllRecords();
    const tRecords = Date.now();
 
    // Department filter applies to the entire page — KPI tiles, error
    // lists, status counts, agents list, AND the trend chart's data.
    const records =
      department && department !== "all" ? all.filter((r) => r.department === department) : all;
 
    const { currentRecords, previousRecords, periodLabel, previousPeriodLabel } =
      this.resolvePeriod(records, period);
    const tPeriod = Date.now();
 
    const currentStats = this.computeStats(currentRecords);
    const previousStats = this.computeStats(previousRecords);
    const tStats = Date.now();
 
    // Status counts and the agents-below-90 list are scoped to the SAME
    // current period + department filter as the KPI tiles above, so the
    // whole page reflects one consistent slice of data.
    const statusCoachCount = currentRecords.filter((r) => r.status_flow === "Completed").length;
    const statusAcknowledgeCount = currentRecords.filter((r) => r.status_acknowledge === "Complete").length;
 
    // Single pass — name/email are captured directly in the map entry, so
    // building agentsBelow90 below never needs to search back through
    // currentRecords (that used to be an O(agents × records) find-inside-map,
    // which got noticeably slower once the period selector could make
    // currentRecords span a whole year instead of just one month).
    const byAgent = new Map<string, { name: string; email: string; sum: number; count: number }>();
    for (const r of currentRecords) {
      const key = r.employee_email ?? r.evaluatee_full_name;
      const entry = byAgent.get(key) ?? {
        name: r.evaluatee_full_name ?? key,
        email: r.employee_email ?? key,
        sum: 0,
        count: 0,
      };
      entry.sum += r.score_sum ?? 0;
      entry.count += 1;
      byAgent.set(key, entry);
    }
    const agentsBelow90 = [...byAgent.values()]
      .map(({ name, email, sum, count }) => ({ name, email, score: (sum / count) * 100 }))
      .filter((a) => a.score < 90)
      .sort((a, b) => a.score - b.score);
    const tAgents = Date.now();
 
    // Trend doesn't depend on `period` at all — only on department — so
    // switching between This Week / This Month / This Year was previously
    // recomputing three identical full bucket passes over the entire
    // department's records every single time. Cached separately, keyed
    // only by department, so that redundant work happens at most once
    // per cache TTL window instead of on every period click.
    const trend = await this.getTrendForDepartment(department, records);
    const tTrend = Date.now();
 
    this.logger.log(
      `getDashboardSummary(department=${department ?? "all"}, period=${period}): ` +
        `records=${tRecords - t0}ms period=${tPeriod - tRecords}ms stats=${tStats - tPeriod}ms ` +
        `agents=${tAgents - tStats}ms trend=${tTrend - tAgents}ms total=${tTrend - t0}ms`
    );
 
    return {
      department: department && department !== "all" ? department : "all",
      period,
      periodLabel,
      previousPeriodLabel,
 
      overallScore: currentStats.overallScore,
      previousOverallScore: previousStats.overallScore,
 
      totalEvaluated: currentStats.totalEvaluated,
      previousTotalEvaluated: previousStats.totalEvaluated,
 
      pass: currentStats.pass,
      previousPass: previousStats.pass,
      passPct: currentStats.passPct,
 
      fail: currentStats.fail,
      previousFail: previousStats.fail,
      failPct: currentStats.failPct,
 
      criticalErrors: currentStats.criticalErrors,
      criticalTotal: currentStats.criticalTotal,
      previousCriticalTotal: previousStats.criticalTotal,
 
      nonCriticalErrors: currentStats.nonCriticalErrors,
      nonCriticalTotal: currentStats.nonCriticalTotal,
      previousNonCriticalTotal: previousStats.nonCriticalTotal,
 
      statusCoachCount,
      statusAcknowledgeCount,
      agentsBelow90,
 
      // Trend chart stays department-filtered but shows FULL history
      // (independent of the period selector) — its own weekly/monthly/
      // yearly toggle already controls bucket granularity.
      trend,
    };
  }
 
  // Cached separately from the rest of the summary, keyed only by
  // department — see the comment at the call site for why.
  private async getTrendForDepartment(department: string | undefined, records: any[]) {
    const cacheKey = `trend:${department && department !== "all" ? department : "all"}`;
    const cached = await this.cacheManager.get<{
      weekly: any[];
      monthly: any[];
      yearly: any[];
    }>(cacheKey);
    if (cached) return cached;
 
    const trend = {
      weekly: this.bucketTrend(records, "week"),
      monthly: this.bucketTrend(records, "month"),
      yearly: this.bucketTrend(records, "year"),
    };
    await this.cacheManager.set(cacheKey, trend);
    return trend;
  }
 
  // Computes the same pass/fail/score/critical-error stats for an arbitrary
  // slice of records — used for both "this period" and "previous period".
  private computeStats(records: any[]) {
    const totalEvaluated = records.length;
    const pass = records.filter((r) => r.evaluation_result === "Pass").length;
    const fail = totalEvaluated - pass;
    const overallScore = totalEvaluated
      ? (records.reduce((sum, r) => sum + (r.score_sum ?? 0), 0) / totalEvaluated) * 100
      : 0;
 
    const failCounts = new Map<string, number>();
    for (const record of records) {
      for (const criterion of CRITERIA) {
        if ((record as any)[criterion.key] === FAIL_VALUE) {
          failCounts.set(criterion.key, (failCounts.get(criterion.key) ?? 0) + 1);
        }
      }
    }
    const toTallyList = (critical: boolean) =>
      CRITERIA.filter((c) => c.critical === critical)
        .map((c) => ({ label: c.label, count: failCounts.get(c.key) ?? 0 }))
        .filter((e) => e.count > 0)
        .sort((a, b) => b.count - a.count);
 
    const criticalErrors = toTallyList(true);
    const nonCriticalErrors = toTallyList(false);
 
    return {
      totalEvaluated,
      pass,
      passPct: totalEvaluated ? Math.round((pass / totalEvaluated) * 100) : 0,
      fail,
      failPct: totalEvaluated ? Math.round((fail / totalEvaluated) * 100) : 0,
      overallScore,
      criticalErrors,
      criticalTotal: criticalErrors.reduce((s, e) => s + e.count, 0),
      nonCriticalErrors,
      nonCriticalTotal: nonCriticalErrors.reduce((s, e) => s + e.count, 0),
    };
  }
 
  // Shared by getDashboardSummary and getAgentFaults — splits an already
  // department-filtered record set into "this period" / "previous period",
  // using the latest such period actually present in the data (not the
  // server clock), so both endpoints agree on exactly what "this period"
  // means for a given department + period combo.
  private resolvePeriod(records: any[], period: Period) {
    const dated = records
      .map((r) => ({ record: r, key: this.periodKeyOf(r.evaluation_date, period) }))
      .filter((d): d is { record: any; key: string } => d.key !== null);
 
    let currentKey: string | null = null;
    if (dated.length > 0) {
      currentKey = dated.reduce((latest, d) => (d.key > latest ? d.key : latest), dated[0].key);
    }
    const previousKey = currentKey ? this.shiftPeriodKey(currentKey, period) : null;
 
    const currentRecords = currentKey
      ? dated.filter((d) => d.key === currentKey).map((d) => d.record)
      : records; // fallback: no parseable dates at all, just use everything
    const previousRecords = previousKey ? dated.filter((d) => d.key === previousKey).map((d) => d.record) : [];
 
    return {
      currentRecords,
      previousRecords,
      periodLabel: currentKey ? this.formatPeriodKey(currentKey, period) : null,
      previousPeriodLabel: previousKey ? this.formatPeriodKey(previousKey, period) : null,
    };
  }
 
  // Per-agent fault breakdown for the Agents Below 90 double-click drill-down
  // — same department + period scoping as the dashboard summary, so the
  // numbers shown here always match what produced that agent's score there.
  async getAgentFaults(email: string, department?: string, period: Period = "month") {
    const all = await this.getAllRecords();
    const deptRecords =
      department && department !== "all" ? all.filter((r) => r.department === department) : all;
 
    const { currentRecords, periodLabel } = this.resolvePeriod(deptRecords, period);
 
    const agentRecords = currentRecords.filter(
      (r) => (r.employee_email ?? r.evaluatee_full_name) === email
    );
    if (agentRecords.length === 0) return null;
 
    const failCounts = new Map<string, number>();
    for (const record of agentRecords) {
      for (const criterion of CRITERIA) {
        if ((record as any)[criterion.key] === FAIL_VALUE) {
          failCounts.set(criterion.key, (failCounts.get(criterion.key) ?? 0) + 1);
        }
      }
    }
    const toTallyList = (critical: boolean) =>
      CRITERIA.filter((c) => c.critical === critical)
        .map((c) => ({ label: c.label, count: failCounts.get(c.key) ?? 0 }))
        .filter((e) => e.count > 0)
        .sort((a, b) => b.count - a.count);
 
    const criticalErrors = toTallyList(true);
    const nonCriticalErrors = toTallyList(false);
    const score = (agentRecords.reduce((sum, r) => sum + (r.score_sum ?? 0), 0) / agentRecords.length) * 100;
 
    return {
      name: agentRecords[0].evaluatee_full_name,
      email,
      department: department && department !== "all" ? department : "all",
      period,
      periodLabel,
      score,
      evaluationCount: agentRecords.length,
      criticalErrors,
      nonCriticalErrors,
    };
  }
 
  // ---- Generic period-key helpers (week / month / year) ----
 
  private periodKeyOf(dateStr: unknown, period: Period): string | null {
    if (typeof dateStr !== "string" || !dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    if (period === "year") return `${d.getFullYear()}`;
    if (period === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return `${d.getFullYear()}-W${this.getISOWeek(d)}`;
  }
 
  private shiftPeriodKey(key: string, period: Period): string {
    if (period === "year") {
      return `${Number(key) - 1}`;
    }
    if (period === "month") {
      const [y, m] = key.split("-").map(Number);
      const d = new Date(y, m - 1 - 1, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
    // week: "YYYY-Www" — find a date inside that ISO week, step back 7 days, recompute the key
    const [yStr, wStr] = key.split("-W");
    const y = Number(yStr);
    const w = Number(wStr);
    const approx = new Date(y, 0, 1 + (w - 1) * 7);
    const dayOfWeek = approx.getDay() || 7;
    const isoThursday = new Date(approx);
    isoThursday.setDate(approx.getDate() - dayOfWeek + 4);
    isoThursday.setDate(isoThursday.getDate() - 7);
    return this.periodKeyOf(isoThursday.toISOString(), "week")!;
  }
 
  private formatPeriodKey(key: string, period: Period): string {
    if (period === "year") return key;
    if (period === "month") {
      const [y, m] = key.split("-").map(Number);
      return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
    }
    // "YYYY-Www" -> a representative date in that ISO week (its Thursday,
    // same convention used in shiftPeriodKey) -> "Aug 2026 W3" style label.
    // The underlying ISO-week grouping/math is untouched — this only
    // affects how the key is displayed.
    const [yStr, wStr] = key.split("-W");
    const y = Number(yStr);
    const w = Number(wStr);
    const approx = new Date(y, 0, 1 + (w - 1) * 7);
    const dayOfWeek = approx.getDay() || 7;
    const thursday = new Date(approx);
    thursday.setDate(approx.getDate() - dayOfWeek + 4);
    const weekOfMonth = Math.ceil(thursday.getDate() / 7);
    return `${thursday.toLocaleString("en-US", { month: "short" })} ${thursday.getFullYear()} W${weekOfMonth}`;
  }
 
  async getAgentsList() {
    const records = await this.getAllRecords();
 
    const seen = new Map<string, string>(); // email -> name
    for (const r of records) {
      const key = r.employee_email ?? r.evaluatee_full_name;
      if (key && !seen.has(key)) seen.set(key, r.evaluatee_full_name);
    }
 
    return [...seen.entries()]
      .map(([email, name]) => ({ email, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
 
  async getAgentSummary(email: string) {
    const allRecords = await this.getAllRecords();
    const records = allRecords.filter((r) => (r.employee_email ?? r.evaluatee_full_name) === email);
 
    if (records.length === 0) return null;
 
    const totalEvaluated = records.length;
    const pass = records.filter((r) => r.evaluation_result === "Pass").length;
    const fail = totalEvaluated - pass;
    const qaScore = (records.reduce((sum, r) => sum + (r.score_sum ?? 0), 0) / totalEvaluated) * 100;
 
    const statusCoachCount = records.filter((r) => r.status_flow === "Completed").length;
    const statusAcknowledgeCount = records.filter((r) => r.status_acknowledge === "Complete").length;
 
    // "Top errors this month" — uses the most recent calendar month present
    // in THIS agent's own records, rather than the server clock, so it still
    // shows something sensible if the underlying data isn't actually current.
    const dated = records
      .filter((r) => r.evaluation_date)
      .map((r) => ({ record: r, date: new Date(r.evaluation_date) }))
      .filter((d) => !isNaN(d.date.getTime()));
 
    let topErrorsThisMonth: { label: string; count: number; pct: number }[] = [];
    let topErrorsMonthLabel: string | null = null;
 
    if (dated.length > 0) {
      const latest = dated.reduce((a, b) => (a.date > b.date ? a : b));
      const y = latest.date.getFullYear();
      const m = latest.date.getMonth();
      topErrorsMonthLabel = latest.date.toLocaleString("en-US", { month: "short", year: "numeric" });
 
      const monthRecords = dated
        .filter((d) => d.date.getFullYear() === y && d.date.getMonth() === m)
        .map((d) => d.record);
 
      const failCounts = new Map<string, number>();
      for (const r of monthRecords) {
        for (const c of CRITERIA) {
          if ((r as any)[c.key] === FAIL_VALUE) {
            failCounts.set(c.key, (failCounts.get(c.key) ?? 0) + 1);
          }
        }
      }
      const totalFails = [...failCounts.values()].reduce((a, b) => a + b, 0);
 
      topErrorsThisMonth = CRITERIA.map((c) => ({ label: c.label, count: failCounts.get(c.key) ?? 0 }))
        .filter((e) => e.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map((e) => ({ ...e, pct: totalFails ? Math.round((e.count / totalFails) * 100) : 0 }));
    }
 
    return {
      name: records[0].evaluatee_full_name,
      email,
      team: records[0].group ?? records[0].department ?? "",
      role: records[0].position ?? "",
      qaScore,
      totalEvaluated,
      pass,
      fail,
      statusCoachCount,
      statusAcknowledgeCount,
      topErrorsThisMonth,
      topErrorsMonthLabel,
      // Not present anywhere in raw-data — surfaced as null so the frontend
      // can render "N/A" rather than a fabricated number.
      coachingLevel: null as string | null,
      ivrTop3Box: null as number | null,
      ivrBottomBox: null as number | null,
      verifyAttempts: [] as { attempt: string; score: number }[],
      trend: {
        weekly: this.bucketTrend(records, "week"),
        monthly: this.bucketTrend(records, "month"),
        yearly: this.bucketTrend(records, "year"),
      },
    };
  }
 
  private bucketTrend(records: any[], unit: "week" | "month" | "year") {
    const buckets = new Map<string, { sum: number; count: number; label: string }>();
 
    for (const r of records) {
      if (!r.evaluation_date) continue;
      const date = new Date(r.evaluation_date);
      if (isNaN(date.getTime())) continue;
 
      let sortKey: string;
      let label: string;
 
      if (unit === "year") {
        sortKey = `${date.getFullYear()}`;
        label = sortKey;
      } else if (unit === "month") {
        sortKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        label = date.toLocaleString("en-US", { month: "short", year: "numeric" }); // "Aug 2026"
      } else {
        // Week-of-month, not ISO week-of-year — "Aug 2026 W3" reads far
        // better on a chart axis than "2026-W35".
        const weekOfMonth = Math.ceil(date.getDate() / 7);
        sortKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${weekOfMonth}`;
        label = `${date.toLocaleString("en-US", { month: "short" })} ${date.getFullYear()} W${weekOfMonth}`;
      }
 
      const entry = buckets.get(sortKey) ?? { sum: 0, count: 0, label };
      entry.sum += r.score_sum ?? 0;
      entry.count += 1;
      buckets.set(sortKey, entry);
    }
 
    return [...buckets.entries()]
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([, { label, sum, count }]) => ({ label, score: (sum / count) * 100 }));
  }
 
  private getISOWeek(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }
}
