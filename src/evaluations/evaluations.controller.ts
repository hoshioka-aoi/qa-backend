import { CacheInterceptor, CacheTTL } from "@nestjs/cache-manager";
import { Controller, Get, NotFoundException, Query, UseInterceptors } from "@nestjs/common";
import { EvaluationsService, Period } from "./evaluations.service";

const VALID_PERIODS: Period[] = ["week", "month", "year"];

@Controller("dashboard")
@UseInterceptors(CacheInterceptor) // caches the response body itself, keyed by full request URL (so department/period combos each cache separately)
export class EvaluationsController {
  constructor(private readonly evaluationsService: EvaluationsService) {}

  @Get("summary")
  @CacheTTL(60 * 1000)
  getSummary(@Query("department") department?: string, @Query("period") period?: string) {
    const resolvedPeriod: Period = VALID_PERIODS.includes(period as Period) ? (period as Period) : "month";
    return this.evaluationsService.getDashboardSummary(department, resolvedPeriod);
  }

  @Get("departments")
  @CacheTTL(60 * 1000)
  getDepartments() {
    return this.evaluationsService.getDepartments();
  }

  @Get("agent-faults")
  @CacheTTL(60 * 1000)
  async getAgentFaults(
    @Query("email") email: string,
    @Query("department") department?: string,
    @Query("period") period?: string
  ) {
    if (!email) {
      throw new NotFoundException("Missing required query param: email");
    }
    const resolvedPeriod: Period = VALID_PERIODS.includes(period as Period) ? (period as Period) : "month";
    const faults = await this.evaluationsService.getAgentFaults(email, department, resolvedPeriod);
    if (!faults) {
      throw new NotFoundException(`No evaluations found for agent: ${email} in this period`);
    }
    return faults;
  }
}