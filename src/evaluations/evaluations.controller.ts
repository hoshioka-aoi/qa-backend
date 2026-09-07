import { CacheInterceptor, CacheTTL } from "@nestjs/cache-manager";
import { Controller, Get, NotFoundException, Query, UseInterceptors } from "@nestjs/common";
import { EvaluationsService } from "./evaluations.service";

@Controller("dashboard")
@UseInterceptors(CacheInterceptor) // caches the response body itself, keyed by full request URL
export class EvaluationsController {
  constructor(private readonly evaluationsService: EvaluationsService) {}

  @Get("summary")
  @CacheTTL(60 * 1000)
  getSummary(
    @Query("department") department?: string,
    @Query("unit") unit?: string,
    @Query("skill") skill?: string,
    @Query("from") from?: string,
    @Query("to") to?: string
  ) {
    return this.evaluationsService.getDashboardSummary(department, unit, skill, from, to);
  }

  @Get("departments")
  @CacheTTL(60 * 1000)
  getDepartments() {
    return this.evaluationsService.getDepartments();
  }

  @Get("units")
  @CacheTTL(60 * 1000)
  getUnits() {
    return this.evaluationsService.getUnits();
  }

  @Get("skills")
  @CacheTTL(60 * 1000)
  getSkills() {
    return this.evaluationsService.getSkills();
  }

  @Get("agent-faults")
  @CacheTTL(60 * 1000)
  async getAgentFaults(
    @Query("email") email: string,
    @Query("department") department?: string,
    @Query("unit") unit?: string,
    @Query("skill") skill?: string,
    @Query("from") from?: string,
    @Query("to") to?: string
  ) {
    if (!email) {
      throw new NotFoundException("Missing required query param: email");
    }
    const faults = await this.evaluationsService.getAgentFaults(email, department, unit, skill, from, to);
    if (!faults) {
      throw new NotFoundException(`No evaluations found for agent: ${email} in this period`);
    }
    return faults;
  }
}