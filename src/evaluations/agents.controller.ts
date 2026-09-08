import { CacheInterceptor, CacheTTL } from "@nestjs/cache-manager";
import { Controller, Get, NotFoundException, Query, UseInterceptors } from "@nestjs/common";
import { EvaluationsService } from "./evaluations.service";

@Controller("agents")
@UseInterceptors(CacheInterceptor)
export class AgentsController {
  constructor(private readonly evaluationsService: EvaluationsService) {}

  @Get()
  @CacheTTL(60 * 1000)
  getAgents(
    @Query("department") department?: string,
    @Query("unit") unit?: string,
    @Query("skill") skill?: string
  ) {
    return this.evaluationsService.getAgentsList(department, unit, skill);
  }

  @Get("summary")
  @CacheTTL(60 * 1000)
  async getAgentSummary(
    @Query("email") email: string,
    @Query("from") from?: string,
    @Query("to") to?: string
  ) {
    if (!email) {
      throw new NotFoundException("Missing required query param: email");
    }
    const summary = await this.evaluationsService.getAgentSummary(email, from, to);
    if (!summary) {
      throw new NotFoundException(`No evaluations found for agent: ${email}`);
    }
    return summary;
  }
}