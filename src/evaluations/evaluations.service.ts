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

const FIELD_PROJECTION = {
  evaluatee_full_name: 1,
  employee_email: 1,
  position: 1,
  department: 1,
  group: 1,
  skill_phone: 1,
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
  private fetchPromise: Promise<any[]> | null = null;

  constructor(
    @InjectModel(Evaluation.name)
    private readonly evaluationModel: Model<EvaluationDocument>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache
  ) {}

  async onModuleInit() {
    await this.warmCaches();
  }

  private async warmCaches() {
    const start = Date.now();
    try {
      const records = await this.getAllRecords();
      this.logger.log(`Warmed raw-data cache: ${records.length} records in ${Date.now() - start}ms`);
    } catch (err) {
      this.logger.warn(`Cache warm-up failed (will retry on first request): ${err}`);
      return;
    }

    const t = Date.now();
    try {
      await this.getDashboardSummary(undefined, undefined, undefined, undefined, undefined);
      this.logger.log(`Warmed default dashboard summary in ${Date.now() - t}ms`);
    } catch (err) {
      this.logger.warn(`Summary warm-up failed: ${err}`);
    }
  }

  private async getAllRecords(): Promise<any[]> {
    const cached = await this.cacheManager.get<any[]>(EvaluationsService.RECORDS_CACHE_KEY);
    if (cached) return cached;

    if (this.fetchPromise) {
      this.logger.debug("getAllRecords: Waiting for ongoing DB fetch...");
      return this.fetchPromise;
    }

    this.fetchPromise = (async () => {
      try {
        const start = Date.now();
        const records = await this.evaluationModel.find({}, FIELD_PROJECTION).lean();
        this.logger.log(`Cache MISS — fetched ${records.length} records from MongoDB in ${Date.now() - start}ms`);
        await this.cacheManager.set(EvaluationsService.RECORDS_CACHE_KEY, records, 0);
        return records;
      } finally {
        this.fetchPromise = null;
      }
    })();

    return this.fetchPromise;
  }

  async invalidateCache() {
    await this.cacheManager.del(EvaluationsService.RECORDS_CACHE_KEY);
  }

  async getDepartments(): Promise<string[]> {
    const records = await this.getAllRecords();
    const set = new Set<string>();
    for (const r of records) {
      const dep = typeof r.department === "string" ? r.department.trim() : "";
      if (dep) set.add(dep);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  async getUnits(): Promise<string[]> {
    return this.getDistinctValues("group");
  }

  async getSkills(): Promise<string[]> {
    return this.getDistinctValues("skill_phone");
  }

  private async getDistinctValues(field: "department" | "group" | "skill_phone"): Promise<string[]> {
    const records = await this.getAllRecords();
    const set = new Set<string>();
    for (const r of records) {
      const value = typeof r[field] === "string" ? r[field].trim() : "";
      if (value) set.add(value);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  async getDashboardSummary(
    department?: string,
    unit?: string,
    skill?: string,
    from?: string,
    to?: string
  ) {
    const t0 = Date.now();
    const all = await this.getAllRecords();
    const tRecords = Date.now();

    let records = department && department !== "all" ? all.filter((r) => r.department === department) : all;
    if (unit && unit !== "all") records = records.filter((r) => r.group === unit);
    if (skill && skill !== "all") records = records.filter((r) => r.skill_phone === skill);

    const { currentRecords, previousRecords, periodLabel, previousPeriodLabel } =
      this.resolveDateRange(records, from, to);
    const tPeriod = Date.now();

    const currentStats = this.computeStats(currentRecords);
    const previousStats = this.computeStats(previousRecords);
    const tStats = Date.now();

    const statusCoachCount = currentRecords.filter((r) => r.status_flow === "Completed").length;
    const statusAcknowledgeCount = currentRecords.filter((r) => r.status_acknowledge === "Complete").length;

    // Single pass — name/email captured directly in the map entry.
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
    const allAgentScores = [...byAgent.values()].map(({ name, email, sum, count }) => ({
      name,
      email,
      score: (sum / count) * 100,
    }));
    const agentsBelow90 = allAgentScores.filter((a) => a.score < 90).sort((a, b) => a.score - b.score);
    // Everyone else who has at least one evaluation in this period/filter
    // scope and is at or above the 90% bar — for the Above/Below 90 tiles.
    const agentsAbove90Count = allAgentScores.length - agentsBelow90.length;
    const tAgents = Date.now();

    const trend = await this.getTrendForFilters(department, unit, skill, records);
    const tTrend = Date.now();

    this.logger.log(
      `getDashboardSummary(department=${department ?? "all"}, from=${from ?? "-"}, to=${to ?? "-"}): ` +
        `records=${tRecords - t0}ms period=${tPeriod - tRecords}ms stats=${tStats - tPeriod}ms ` +
        `agents=${tAgents - tStats}ms trend=${tTrend - tAgents}ms total=${tTrend - t0}ms`
    );

    return {
      department: department && department !== "all" ? department : "all",
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
      agentsAbove90Count,
      agentsBelow90,

      trend,
    };
  }

  private async getTrendForFilters(
    department: string | undefined,
    unit: string | undefined,
    skill: string | undefined,
    records: any[]
  ) {
    const cacheKey = `trend:${department && department !== "all" ? department : "all"}:${
      unit && unit !== "all" ? unit : "all"
    }:${skill && skill !== "all" ? skill : "all"}`;
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

  private resolveDateRange(records: any[], from?: string, to?: string) {
    if (from && to) {
      const fromDate = new Date(`${from}T00:00:00`);
      const toDate = new Date(`${to}T23:59:59.999`);
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate > toDate) {
        // fall through
      } else {
        const rangeMs = toDate.getTime() - fromDate.getTime() + 1;
        const prevTo = new Date(fromDate.getTime() - 1);
        const prevFrom = new Date(fromDate.getTime() - rangeMs);

        const inRange = (r: any, start: Date, end: Date) => {
          if (!r.evaluation_date) return false;
          const d = new Date(r.evaluation_date);
          return !isNaN(d.getTime()) && d >= start && d <= end;
        };

        const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

        return {
          currentRecords: records.filter((r) => inRange(r, fromDate, toDate)),
          previousRecords: records.filter((r) => inRange(r, prevFrom, prevTo)),
          periodLabel: `${fmt(fromDate)} – ${fmt(toDate)}`,
          previousPeriodLabel: `${fmt(prevFrom)} – ${fmt(prevTo)}`,
        };
      }
    }

    const dated = records
      .map((r) => ({ record: r, key: this.monthKeyOf(r.evaluation_date) }))
      .filter((d): d is { record: any; key: string } => d.key !== null);

    let currentKey: string | null = null;
    if (dated.length > 0) {
      currentKey = dated.reduce((latest, d) => (d.key > latest ? d.key : latest), dated[0].key);
    }
    const previousKey = currentKey ? this.shiftMonthKey(currentKey, -1) : null;

    const currentRecords = currentKey
      ? dated.filter((d) => d.key === currentKey).map((d) => d.record)
      : records;
    const previousRecords = previousKey ? dated.filter((d) => d.key === previousKey).map((d) => d.record) : [];

    return {
      currentRecords,
      previousRecords,
      periodLabel: currentKey ? this.formatMonthKey(currentKey) : null,
      previousPeriodLabel: previousKey ? this.formatMonthKey(previousKey) : null,
    };
  }

  async getAgentFaults(
    email: string,
    department?: string,
    unit?: string,
    skill?: string,
    from?: string,
    to?: string
  ) {
    const all = await this.getAllRecords();
    let filtered = department && department !== "all" ? all.filter((r) => r.department === department) : all;
    if (unit && unit !== "all") filtered = filtered.filter((r) => r.group === unit);
    if (skill && skill !== "all") filtered = filtered.filter((r) => r.skill_phone === skill);

    const { currentRecords, periodLabel } = this.resolveDateRange(filtered, from, to);

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
      periodLabel,
      score,
      evaluationCount: agentRecords.length,
      criticalErrors,
      nonCriticalErrors,
    };
  }

  private monthKeyOf(dateStr: unknown): string | null {
    if (typeof dateStr !== "string" || !dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  private shiftMonthKey(key: string, delta: number): string {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  private formatMonthKey(key: string): string {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
  }

  async getAgentsList(department?: string, unit?: string, skill?: string) {
    const all = await this.getAllRecords();
    let records = department && department !== "all" ? all.filter((r) => r.department === department) : all;
    if (unit && unit !== "all") records = records.filter((r) => r.group === unit);
    if (skill && skill !== "all") records = records.filter((r) => r.skill_phone === skill);

    const seen = new Map<string, string>();
    for (const r of records) {
      const key = r.employee_email ?? r.evaluatee_full_name;
      if (key && !seen.has(key)) seen.set(key, r.evaluatee_full_name);
    }
    return [...seen.entries()]
      .map(([email, name]) => ({ email, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getAgentSummary(email: string, from?: string, to?: string) {
    const allRecords = await this.getAllRecords();
    const records = allRecords.filter((r) => (r.employee_email ?? r.evaluatee_full_name) === email);
    if (records.length === 0) return null;

    const { currentRecords, previousRecords, periodLabel, previousPeriodLabel } =
      this.resolveDateRange(records, from, to);

    const currentStats = this.computeStats(currentRecords);
    const previousStats = this.computeStats(previousRecords);

    const statusCoachCount = currentRecords.filter((r) => r.status_flow === "Completed").length;
    const statusAcknowledgeCount = currentRecords.filter((r) => r.status_acknowledge === "Complete").length;

    // Top errors for whichever period is currently in scope (a custom
    // range from the calendar picker, or the default latest-month
    // fallback) — same failCounts approach as before, just sourced from
    // currentRecords instead of a separately-computed "latest month".
    const failCounts = new Map<string, number>();
    for (const r of currentRecords) {
      for (const c of CRITERIA) {
        if ((r as any)[c.key] === FAIL_VALUE) {
          failCounts.set(c.key, (failCounts.get(c.key) ?? 0) + 1);
        }
      }
    }
    const totalFails = [...failCounts.values()].reduce((a, b) => a + b, 0);
    const topErrorsThisMonth = CRITERIA.map((c) => ({ label: c.label, count: failCounts.get(c.key) ?? 0 }))
      .filter((e) => e.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((e) => ({ ...e, pct: totalFails ? Math.round((e.count / totalFails) * 100) : 0 }));

    return {
      name: records[0].evaluatee_full_name,
      email,
      team: records[0].group ?? records[0].department ?? "",
      role: records[0].position ?? "",

      qaScore: currentStats.overallScore,
      previousQaScore: previousStats.overallScore,

      totalEvaluated: currentStats.totalEvaluated,
      previousTotalEvaluated: previousStats.totalEvaluated,

      pass: currentStats.pass,
      previousPass: previousStats.pass,

      fail: currentStats.fail,
      previousFail: previousStats.fail,

      statusCoachCount,
      statusAcknowledgeCount,
      topErrorsThisMonth,
      topErrorsMonthLabel: periodLabel,
      previousPeriodLabel,
      coachingLevel: null as string | null,
      ivrTop3Box: null as number | null,
      ivrBottomBox: null as number | null,
      verifyAttempts: [] as { attempt: string; score: number }[],

      // Trend stays full history regardless of the selected date range —
      // same reasoning as the dashboard's trend chart.
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
        label = date.toLocaleString("en-US", { month: "short", year: "numeric" });
      } else {
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